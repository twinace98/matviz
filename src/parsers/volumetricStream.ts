/**
 * v0.23.1 Feature 23.1.3 — streaming volumetric parser (Node only).
 *
 * Reads cube / XSF / CHGCAR files with `fs.createReadStream` in fixed-size
 * chunks and downsamples while reading, so peak memory ≈ the output grids
 * (+ one chunk + one source row) regardless of the on-disk size. Removes the
 * 2 GiB `fs.readFile` limit and the 512 MiB string limit of the older paths.
 *
 * Flow: `probeVolumetric` (header-only) → read the header bytes
 * [0, dataOffset) and parse them with the existing header parsers → stream
 * from `dataOffset`. Grid values are scanned straight from the bytes (no
 * per-line strings); everything between grids (XSF grid headers, CHGCAR
 * augmentation blocks) goes through a small line state machine that mirrors
 * the byte-path parsers.
 *
 * Numbers: the common "1.234567E-03" form is decoded with Clinger's fast path
 * (≤ 15 significant digits, |exp10| ≤ 22 → one correctly rounded operation),
 * which equals `parseFloat` bit-for-bit; anything else falls back to
 * `parseFloat` on the token — so factor-1 output is bit-identical to the
 * string and byte paths.
 *
 * Not imported by `index.ts`: the webview / embed bundles must stay free of
 * `fs`. Used by the extension host and the CLI.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { CrystalStructure, VolumetricData } from './types';
import { GridResampler, detectRedundantEndpoints, outputCount } from './downsample';
import { probeVolumetric, VolumetricProbe } from './volumetricProbe';
import { parseCubeHeader } from './cubeParser';
import { parseXsf, trimRedundantPeriodicPlanes, snapGridLatticeToCell } from './xsfParser';
import { parsePoscar } from './poscarParser';
import { findPoscarEnd, buildChgcarGrids, cellVolume } from './chgcarParser';
import { finalizeVolumetricResult, ParseTrajectoryResult } from './index';

type Dims = [number, number, number];

export interface StreamOptions {
  /** Downsampling factor; default = the probe's recommendation for `maxGridPoints`. */
  factor?: number;
  /** Point budget per grid used when `factor` is not given (null → safety default). */
  maxGridPoints?: number | null;
  /** Reuse a probe already taken (e.g. for a resolution prompt). */
  probe?: VolumetricProbe;
  /** Read chunk size (default 4 MiB). Tests use tiny chunks to exercise boundaries. */
  highWaterMark?: number;
  /** Called after every chunk with bytes consumed so far and the file size. */
  onProgress?: (bytesRead: number, total: number) => void;
  /** Abort reading; the promise rejects with an Error named 'AbortError'. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Number scanning

const POW10 = Array.from({ length: 23 }, (_, i) => 10 ** i);
const latin1 = new TextDecoder('latin1');

/** parseFloat-identical value of the ASCII token in buf[0, len). */
export function parseNumberToken(buf: Uint8Array, len: number): number {
  let i = 0, neg = false;
  if (buf[0] === 0x2D) { neg = true; i = 1; } else if (buf[0] === 0x2B) { i = 1; }
  let m = 0, sig = 0, frac = 0, digits = 0, ok = true;
  for (; i < len; i++) {
    const c = buf[i] - 0x30;
    if (c < 0 || c > 9) break;
    digits++;
    if (m !== 0 || c !== 0) { if (++sig > 15) { ok = false; break; } }
    m = m * 10 + c;
  }
  if (ok && i < len && buf[i] === 0x2E) {
    for (i++; i < len; i++) {
      const c = buf[i] - 0x30;
      if (c < 0 || c > 9) break;
      digits++; frac++;
      if (m !== 0 || c !== 0) { if (++sig > 15) { ok = false; break; } }
      m = m * 10 + c;
    }
  }
  let e = 0;
  if (ok && i < len && (buf[i] === 0x65 || buf[i] === 0x45)) {
    let j = i + 1, eneg = false, ed = 0;
    if (buf[j] === 0x2D) { eneg = true; j++; } else if (buf[j] === 0x2B) { j++; }
    for (; j < len; j++) {
      const c = buf[j] - 0x30;
      if (c < 0 || c > 9) break;
      e = e * 10 + c; ed++;
      if (e > 400) break;
    }
    if (ed === 0) ok = false; else { i = j; if (eneg) e = -e; }
  }
  if (ok && digits > 0 && i === len) {
    const p = e - frac;
    if (m === 0) return neg ? -0 : 0;
    if (p >= -22 && p <= 22) {
      const v = p >= 0 ? m * POW10[p] : m / POW10[-p];
      return neg ? -v : v;
    }
  }
  return parseFloat(latin1.decode(buf.subarray(0, len)));
}

// ---------------------------------------------------------------------------
// Value sinks (where scanned grid values go)

interface Sink { push(v: number): void; finish(): Float32Array }

/** Full-resolution store; `xFastest` = file order is x fastest (XSF / CHGCAR). */
class DirectSink implements Sink {
  private data: Float32Array;
  private ix = 0; private iy = 0; private iz = 0; private n = 0;
  constructor(private dims: Dims, private xFastest: boolean) {
    this.data = new Float32Array(dims[0] * dims[1] * dims[2]);
  }
  push(v: number) {
    if (!this.xFastest) { this.data[this.n++] = v; return; }
    const [nx, ny, nz] = this.dims;
    this.data[this.ix * ny * nz + this.iy * nz + this.iz] = v;
    if (++this.ix === nx) { this.ix = 0; if (++this.iy === ny) { this.iy = 0; this.iz++; } }
  }
  finish() { return this.data; }
}

/**
 * Downsampling sink. When the closure flags are not known up front (XSF grid
 * whose dims differ from the probed first grid), the first plane is buffered,
 * judged, then replayed into the resampler.
 */
class ResampleSink implements Sink {
  private r: GridResampler | null = null;
  private pending: number[] | null = null;
  outDims: Dims = [0, 0, 0];
  constructor(
    private dims: Dims, private factor: number, private xFastest: boolean,
    private skip: [boolean, boolean, boolean] | null,
  ) {
    if (skip) this.start(skip); else this.pending = [];
  }
  private start(skip: [boolean, boolean, boolean]) {
    this.outDims = [0, 1, 2].map(a => outputCount(this.dims[a], this.factor, skip[a])) as Dims;
    this.r = new GridResampler(this.dims, this.outDims, { order: this.xFastest ? 'x-fastest' : 'z-fastest', skipLast: skip });
  }
  push(v: number) {
    if (this.r) { this.r.push(v); return; }
    const p = this.pending!;
    p.push(v);
    if (p.length === this.dims[0] * this.dims[1]) {
      this.skip = detectRedundantEndpoints(this.dims, p, null);
      this.start(this.skip);
      for (const x of p) this.r!.push(x);
      this.pending = null;
    }
  }
  finish() {
    if (!this.r) { this.start([false, false, false]); for (const x of this.pending!) this.r!.push(x); }
    return this.r!.finish();
  }
}

// ---------------------------------------------------------------------------
// Chunk scanner: data mode (numbers) / line mode (everything else)

interface Handler {
  /** A complete line (line mode). May call `scanner.enterData`. */
  onLine(line: string): void;
  /** The expected number of values has been read. */
  onDataComplete(): void;
  /** A non-numeric token appeared before the grid was complete. */
  onDataInterrupted(): void;
}

const isSpace = (b: number) => b === 0x20 || b === 0x09 || b === 0x0A || b === 0x0D;
const isNumStart = (b: number) =>
  (b >= 0x30 && b <= 0x39) || b === 0x2D || b === 0x2B || b === 0x2E ||
  b === 0x4E || b === 0x6E || b === 0x49 || b === 0x69;  // N/n(aN), I/i(nfinity)

class Scanner {
  mode: 'line' | 'data' | 'skipEol' = 'line';
  handler!: Handler;
  private sink: Sink | null = null;
  private remaining = 0;
  private tok = new Uint8Array(512);
  private tokLen = 0;
  private lineParts: Uint8Array[] = [];
  private decoder = new TextDecoder('utf-8', { fatal: false });

  enterData(total: number, sink: Sink) {
    this.mode = 'data'; this.remaining = total; this.sink = sink;
  }

  feed(chunk: Uint8Array) {
    const n = chunk.length;
    let i = 0;
    while (i < n) {
      if (this.mode === 'data') {
        // Continue / start a token.
        if (this.tokLen > 0 || !isSpace(chunk[i])) {
          if (this.tokLen === 0 && !isNumStart(chunk[i])) {
            // Text where a number should be: hand the rest of the line over.
            this.mode = 'line';
            this.handler.onDataInterrupted();
            continue;
          }
          while (i < n && !isSpace(chunk[i])) {
            if (this.tokLen < this.tok.length) this.tok[this.tokLen] = chunk[i];
            this.tokLen++; i++;
          }
          if (i === n) break;  // token may continue in the next chunk
          this.emitToken();
          continue;
        }
        i++;
      } else if (this.mode === 'skipEol') {
        while (i < n && chunk[i] !== 0x0A) i++;
        if (i < n) { i++; this.mode = 'line'; }
      } else {
        let j = i;
        while (j < n && chunk[j] !== 0x0A) j++;
        this.lineParts.push(chunk.subarray(i, j));
        if (j === n) {
          // Partial line: copy (the chunk buffer is reused by the stream).
          this.lineParts[this.lineParts.length - 1] = chunk.slice(i, j);
          break;
        }
        i = j + 1;
        this.flushLine();
      }
    }
  }

  private emitToken() {
    const len = Math.min(this.tokLen, this.tok.length);
    this.tokLen = 0;
    this.sink!.push(parseNumberToken(this.tok, len));
    if (--this.remaining === 0) {
      this.mode = 'skipEol';
      this.handler.onDataComplete();
    }
  }

  private flushLine() {
    const parts = this.lineParts;
    this.lineParts = [];
    let bytes: Uint8Array;
    if (parts.length === 1) bytes = parts[0];
    else {
      bytes = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
      let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
    }
    let line = this.decoder.decode(bytes);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    this.handler.onLine(line);
  }

  /** End of file: flush a pending token / line. */
  end() {
    if (this.mode === 'data' && this.tokLen > 0) this.emitToken();
    else if (this.mode === 'line' && this.lineParts.length > 0) this.flushLine();
  }
}

// ---------------------------------------------------------------------------
// Format handlers

interface GridOut { data: Float32Array; dims: Dims; srcDims: Dims; origin: Dims; lattice: Dims[]; label: string }

function makeSink(dims: Dims, factor: number, xFastest: boolean, skip: [boolean, boolean, boolean] | null): Sink & { outDims?: Dims } {
  return factor > 1 ? new ResampleSink(dims, factor, xFastest, skip) : new DirectSink(dims, xFastest);
}
const sinkOutDims = (s: Sink & { outDims?: Dims }, dims: Dims): Dims => (s instanceof ResampleSink ? s.outDims : dims);

const parseVec = (line: string): Dims => {
  const t = line.trim().split(/\s+/).map(Number);
  return [t[0] || 0, t[1] || 0, t[2] || 0];
};
const dimsLine = (line: string): Dims | null => {
  const t = line.trim().split(/\s+/);
  return t.length === 3 && t.every(x => /^\d+$/.test(x)) ? [+t[0], +t[1], +t[2]] : null;
};

/** XSF: multiple BEGIN_DATAGRID_3D blocks; mirrors parseDatagrids3DFromBytes. */
class XsfHandler implements Handler {
  grids: GridOut[] = [];
  private stage: 'find-begin' | 'dims' | 'origin' | 'vec1' | 'vec2' | 'vec3' | 'data' | 'after' = 'find-begin';
  private label = '';
  private count = 0;
  private dims: Dims = [0, 0, 0];
  private origin: Dims = [0, 0, 0];
  private lattice: Dims[] = [];
  private sink: (Sink & { outDims?: Dims }) | null = null;
  constructor(private sc: Scanner, private factor: number, private probe: VolumetricProbe) {}

  onLine(raw: string) {
    const line = raw.trim();
    switch (this.stage) {
      case 'find-begin':
        if (line.startsWith('BEGIN_DATAGRID_3D')) {
          this.count++;
          this.label = line.slice('BEGIN_DATAGRID_3D'.length).replace(/^_+/, '').trim();
          this.stage = 'dims';
        }
        return;
      case 'dims': {
        const d = dimsLine(line) ?? (line.split(/\s+/).map(Number).slice(0, 3) as Dims);
        this.dims = d; this.stage = 'origin'; return;
      }
      case 'origin': this.origin = parseVec(line); this.stage = 'vec1'; return;
      case 'vec1': case 'vec2': case 'vec3':
        this.lattice.push(parseVec(line));
        if (this.stage !== 'vec3') { this.stage = this.stage === 'vec1' ? 'vec2' : 'vec3'; return; }
        this.startData();
        return;
      case 'data': case 'after':
        if (line.startsWith('END_DATAGRID_3D') || line.startsWith('END_BLOCK_DATAGRID_3D')) {
          this.finalize();
          this.stage = 'find-begin';
        }
        return;
    }
  }
  private startData() {
    const sameAsProbe = this.dims.every((v, a) => v === this.probe.dims[a]);
    const skip = sameAsProbe ? this.probe.redundantEndpoint : null;
    this.sink = makeSink(this.dims, this.factor, true, skip);
    this.stage = 'data';
    this.sc.enterData(this.dims[0] * this.dims[1] * this.dims[2], this.sink);
  }
  onDataComplete() { this.stage = 'after'; }
  onDataInterrupted() { this.stage = 'after'; }  // the END line follows; finalize there
  finalize() {
    if (!this.sink) return;
    const data = this.sink.finish();
    this.grids.push({
      data, dims: sinkOutDims(this.sink, this.dims), srcDims: this.dims,
      origin: this.origin, lattice: this.lattice, label: this.label || `datagrid_${this.count}`,
    });
    this.sink = null; this.lattice = []; this.origin = [0, 0, 0];
  }
}

/** CHGCAR: grid blocks separated by augmentation sections + repeated dims line. */
class ChgcarHandler implements Handler {
  raw: Float32Array[] = [];
  outDims: Dims;
  private sink: (Sink & { outDims?: Dims }) | null = null;
  private seeking = false;
  constructor(private sc: Scanner, private dims: Dims, private factor: number) {
    this.outDims = factor > 1 ? (dims.map(n => outputCount(n, factor)) as Dims) : dims;
  }
  start() {
    this.sink = makeSink(this.dims, this.factor, true, [false, false, false]);
    this.seeking = false;
    this.sc.enterData(this.dims[0] * this.dims[1] * this.dims[2], this.sink);
  }
  onLine(raw: string) {
    if (!this.seeking) return;
    const d = dimsLine(raw);
    if (d && d[0] === this.dims[0] && d[1] === this.dims[1] && d[2] === this.dims[2]) this.start();
  }
  onDataComplete() { this.raw.push(this.sink!.finish()); this.sink = null; this.seeking = true; }
  onDataInterrupted() { this.sink = null; this.seeking = true; }  // malformed block: drop partial
}

/** Cube: one grid, data straight after the header. */
class CubeHandler implements Handler {
  data: Float32Array | null = null;
  outDims: Dims;
  private sink: Sink & { outDims?: Dims };
  constructor(sc: Scanner, private dims: Dims, factor: number) {
    this.sink = makeSink(dims, factor, false, [false, false, false]);
    this.outDims = factor > 1 ? (dims.map(n => outputCount(n, factor)) as Dims) : dims;
    sc.enterData(dims[0] * dims[1] * dims[2], this.sink);
  }
  onLine() {}
  onDataComplete() { this.data = this.sink.finish(); }
  onDataInterrupted() { this.data = this.sink.finish(); }
  finishIfPending() { if (!this.data) this.data = this.sink.finish(); }
}

// ---------------------------------------------------------------------------

function abortError(): Error {
  const e = new Error('Volumetric load cancelled');
  e.name = 'AbortError';
  return e;
}

async function readRange(file: string, start: number, end: number): Promise<Uint8Array> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = new Uint8Array(end - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.subarray(0, bytesRead);
  } finally { await fh.close(); }
}

/**
 * Structure only (atoms, lattice, symmetry) from the header bytes — no grid
 * data is read. Used by CLI `--info` on files of any size.
 */
export async function readVolumetricStructure(
  filePath: string,
  filename: string = path.basename(filePath),
  probe?: VolumetricProbe,
): Promise<{ structure: CrystalStructure; probe: VolumetricProbe }> {
  const p = probe ?? await probeVolumetric(filePath, filename);
  const headerText = new TextDecoder('utf-8', { fatal: false }).decode(await readRange(filePath, 0, p.dataOffset));
  let structure: CrystalStructure;
  if (p.format === 'cube') structure = parseCubeHeader(headerText.split('\n')).structure;
  else if (p.format === 'chgcar') {
    const lines = headerText.split('\n');
    structure = parsePoscar(lines.slice(0, findPoscarEnd(lines)).join('\n'));
  } else {
    const marker = headerText.indexOf('BEGIN_BLOCK_DATAGRID_3D');
    const { volumetric: _v, volumetrics: _vs, ...st } = parseXsf(marker >= 0 ? headerText.slice(0, marker) : headerText);
    structure = st as CrystalStructure;
  }
  return { structure: finalizeVolumetricResult(structure, [], filename).trajectory.frames[0], probe: p };
}

export async function parseVolumetricStream(
  filePath: string,
  filename: string = path.basename(filePath),
  opts: StreamOptions = {},
): Promise<ParseTrajectoryResult & { probe: VolumetricProbe; factor: number }> {
  const probe = opts.probe ?? await probeVolumetric(filePath, filename, { maxGridPoints: opts.maxGridPoints });
  const factor = Math.max(1, Math.floor(opts.factor ?? probe.recommendedFactor));
  if (opts.signal?.aborted) throw abortError();

  const headerText = new TextDecoder('utf-8', { fatal: false }).decode(await readRange(filePath, 0, probe.dataOffset));
  const sc = new Scanner();
  let structure: CrystalStructure;
  let finish: () => VolumetricData[];

  if (probe.format === 'cube') {
    const h = parseCubeHeader(headerText.split('\n'));
    structure = h.structure;
    const handler = new CubeHandler(sc, h.dims as Dims, factor);
    sc.handler = handler;
    finish = () => {
      handler.finishIfPending();
      const v: VolumetricData = { origin: h.origin, lattice: h.lattice, dims: handler.outDims, data: handler.data! };
      if (factor > 1) { v.stride = factor; v.originalDims = h.dims as Dims; }
      return [v];
    };
  } else if (probe.format === 'chgcar') {
    const lines = headerText.split('\n');
    structure = parsePoscar(lines.slice(0, findPoscarEnd(lines)).join('\n'));
    const handler = new ChgcarHandler(sc, probe.dims, factor);
    sc.handler = handler;
    handler.start();
    finish = () => buildChgcarGrids(
      handler.raw, structure.lattice, handler.outDims, 1 / cellVolume(structure.lattice),
      factor > 1 ? factor : undefined, probe.dims,
    );
  } else {
    const marker = headerText.indexOf('BEGIN_BLOCK_DATAGRID_3D');
    const head = parseXsf(marker >= 0 ? headerText.slice(0, marker) : headerText);
    const { volumetric: _v, volumetrics: _vs, ...st } = head;
    structure = st as CrystalStructure;
    const handler = new XsfHandler(sc, factor, probe);
    sc.handler = handler;
    // Run the grid header lines through the state machine; the last vector
    // line switches the scanner to data mode, and the stream starts there.
    for (const l of headerText.slice(marker >= 0 ? marker : 0).split('\n')) handler.onLine(l);
    finish = () => {
      handler.finalize();  // grid still open at EOF (no END line); no-op otherwise
      return handler.grids.map(g => {
        const out: VolumetricData = { origin: g.origin, lattice: g.lattice, dims: g.dims, data: g.data };
        let v = out;
        if (factor > 1) { out.stride = factor; out.originalDims = g.srcDims; }
        else v = trimRedundantPeriodicPlanes(out);
        v.name = g.label;
        snapGridLatticeToCell(v, structure.lattice);
        return v;
      });
    };
  }

  // Stream the grid data.
  await new Promise<void>((resolve, reject) => {
    const rs = fs.createReadStream(filePath, { start: probe.dataOffset, highWaterMark: opts.highWaterMark ?? (4 << 20) });
    let read = probe.dataOffset;
    const onAbort = () => { rs.destroy(); reject(abortError()); };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    rs.on('data', (chunk: Buffer | string) => {
      const b = chunk as Buffer;
      try { sc.feed(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)); }
      catch (e) { rs.destroy(); reject(e); return; }
      read += b.byteLength;
      opts.onProgress?.(read, probe.fileSize);
    });
    rs.on('error', reject);
    rs.on('end', () => { opts.signal?.removeEventListener('abort', onAbort); sc.end(); resolve(); });
  });

  const volumetrics = finish();
  if (volumetrics.length === 0) throw new Error(`stream: no complete grid found in ${filename}`);
  return { ...finalizeVolumetricResult(structure, volumetrics, filename), probe, factor };
}
