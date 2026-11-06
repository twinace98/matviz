/**
 * v0.23.1 Feature 23.1.2 — header-only volumetric preflight.
 *
 * Reads just enough of a cube / XSF / CHGCAR file to report the grid shape,
 * how many grids it holds (estimated), how much memory a full-resolution load
 * would take, and which downsampling factor fits a point budget — BEFORE any
 * grid data is parsed. The extension's resolution prompt and the CLI `--info`
 * output are driven by this; the streaming parser (23.1.3) reuses `dataOffset`
 * and the XSF closure-plane flags.
 *
 * Cost: a few positioned reads. Head: 256 KiB steps until the grid header is
 * found (cap `maxHeaderBytes`). XSF only: the first data plane (head) and the
 * last plane before the final `END_DATAGRID_3D` (tail), each capped at
 * `maxPlaneBytes`. Pure Node `fs`; usable from the extension host and the CLI.
 */
import * as fs from 'fs';
import * as path from 'path';
import { VOLUMETRIC_SAFETY_MAX_GRID_POINTS, chooseStride } from './types';
import { iterLineSpans, firstNumbers, lastNumbersBefore } from './lineIterator';
import { detectRedundantEndpointsDetailed, outputCount } from './downsample';
import { findPoscarEnd } from './chgcarParser';

export type VolumetricFormat = 'cube' | 'xsf' | 'chgcar';
type Dims = [number, number, number];

/** Format by filename, mirroring the parser dispatch (`hasBytePath`). */
export function volumetricFormatOf(filename: string): VolumetricFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.cube') || lower.endsWith('.cub')) return 'cube';
  if (lower.endsWith('.xsf') || lower.endsWith('.axsf')) return 'xsf';
  if (lower === 'chgcar' || lower === 'aeccar0' || lower === 'aeccar2' || lower === 'parchg') return 'chgcar';
  return null;
}

export interface VolumetricProbe {
  format: VolumetricFormat;
  fileSize: number;
  /** Grid shape as written in the file (first grid). */
  dims: Dims;
  /** Shape after dropping XSF periodic-closure planes (= dims otherwise). */
  effectiveDims: Dims;
  /** Grids stored in the file. Exact for cube; estimated from file size otherwise. */
  gridCount: number;
  gridCountEstimated: boolean;
  /** Grids the loader will hold (CHGCAR ISPIN=2 → charge, magnetization, spin_up, spin_down). */
  outputGridCount: number;
  /** Bytes of Float32 grid data a full-resolution load keeps (all output grids). */
  fullResBytes: number;
  /** Smallest integer factor keeping one grid ≤ the point budget. */
  recommendedFactor: number;
  recommendedDims: Dims;
  /** XSF closure planes per axis (x, y, z). */
  redundantEndpoint: [boolean, boolean, boolean];
  /**
   * 'data' = every axis measured from the planes; 'convention' = at least one
   * axis inferred (near-zero boundary, multi-grid tail, or plane too large);
   * 'none' = not applicable (cube / CHGCAR).
   */
  endpointSource: 'data' | 'convention' | 'none';
  /** Byte offset of the first grid's first value. */
  dataOffset: number;
  /** Average bytes per value in the first data lines (drives the estimates). */
  bytesPerValue: number;
  /** Total bytes this probe read from disk. */
  bytesRead: number;
}

export interface ProbeOptions {
  /** Point budget per grid (null/undefined → safety default 4×10⁸). */
  maxGridPoints?: number | null;
  /** Give up if the grid header is not found within this many bytes (16 MiB). */
  maxHeaderBytes?: number;
  /** Largest XSF data plane (text bytes) read for closure detection (64 MiB). */
  maxPlaneBytes?: number;
}

/** Output dims for a given factor (closure planes already excluded). */
export function dimsForFactor(p: VolumetricProbe, factor: number): Dims {
  const skip = p.redundantEndpoint;
  return [0, 1, 2].map(a => outputCount(p.dims[a], factor, skip[a])) as Dims;
}

/** Float32 bytes held for all output grids at the given factor. */
export function bytesForFactor(p: VolumetricProbe, factor: number): number {
  const d = dimsForFactor(p, factor);
  return 4 * d[0] * d[1] * d[2] * p.outputGridCount;
}

/** Incremental positioned reader over the head of a file. */
class HeadReader {
  buf = new Uint8Array(0);
  bytesRead = 0;
  constructor(private fd: fs.promises.FileHandle, readonly size: number) {}
  /** Make sure at least `n` bytes (or the whole file) are buffered. */
  async ensure(n: number): Promise<void> {
    const want = Math.min(n, this.size);
    if (this.buf.length >= want) return;
    const next = new Uint8Array(want);
    next.set(this.buf);
    const { bytesRead } = await this.fd.read(next, this.buf.length, want - this.buf.length, this.buf.length);
    this.bytesRead += bytesRead;
    this.buf = next.subarray(0, this.buf.length + bytesRead);
  }
  async readAt(pos: number, len: number): Promise<Uint8Array> {
    const out = new Uint8Array(len);
    const { bytesRead } = await this.fd.read(out, 0, len, pos);
    this.bytesRead += bytesRead;
    return out.subarray(0, bytesRead);
  }
}

interface HeaderInfo { dims: Dims; dataOffset: number }

/**
 * Complete lines (with end offsets) of the buffered head. A trailing line
 * without a terminator is dropped unless the buffer is the whole file — a
 * read boundary could otherwise cut "40 40 64" into "40 40 6".
 */
function lines(buf: Uint8Array, wholeFile: boolean) {
  const out: Array<{ line: string; next: number }> = [];
  for (const l of iterLineSpans(buf)) out.push(l);
  const last = buf.length > 0 ? buf[buf.length - 1] : 0x0A;
  if (!wholeFile && out.length > 0 && last !== 0x0A && last !== 0x0D) out.pop();
  return out;
}

const dimsOf = (s: string): Dims | null => {
  const t = s.trim().split(/\s+/).map(Number);
  return t.length >= 3 && t.slice(0, 3).every(v => Number.isInteger(v) && v > 0) ? [t[0], t[1], t[2]] : null;
};

function cubeHeader(buf: Uint8Array, wholeFile: boolean): HeaderInfo | null {
  const ls = lines(buf, wholeFile);
  if (ls.length < 6) return null;
  const nAtoms = Math.abs(Math.round(Number(ls[2].line.trim().split(/\s+/)[0])));
  const dataLine = 6 + nAtoms;  // same rule as parseCubeHeader / parseCubeFromBytes
  if (ls.length <= dataLine) return null;
  const n = [3, 4, 5].map(i => Math.abs(Math.round(Number(ls[i].line.trim().split(/\s+/)[0]))));
  if (!n.every(v => v > 0)) throw new Error('probe: bad cube grid dimensions');
  return { dims: n as Dims, dataOffset: ls[dataLine - 1].next };
}

function xsfHeader(buf: Uint8Array, wholeFile: boolean): HeaderInfo | null {
  const ls = lines(buf, wholeFile);
  for (let i = 0; i < ls.length; i++) {
    if (!ls[i].line.trim().startsWith('BEGIN_DATAGRID_3D')) continue;
    // dims, origin, 3 spanning vectors, then data
    let k = i + 1;
    while (k < ls.length && ls[k].line.trim() === '') k++;
    if (k + 4 >= ls.length) return null;
    const d = dimsOf(ls[k].line);
    if (!d) throw new Error('probe: bad XSF DATAGRID dimensions');
    return { dims: d, dataOffset: ls[k + 4].next };
  }
  return null;
}

function chgcarHeader(buf: Uint8Array, wholeFile: boolean): HeaderInfo | null {
  const ls = lines(buf, wholeFile);
  const poscarEnd = findPoscarEnd(ls.map(l => l.line));
  let k = poscarEnd;
  while (k < ls.length && ls[k].line.trim() === '') k++;
  if (k >= ls.length - 1) return null;
  const d = dimsOf(ls[k].line);
  if (!d) throw new Error('probe: CHGCAR grid-dims line not found after the POSCAR block');
  return { dims: d, dataOffset: ls[k].next };
}

const HEADER_PARSERS: Record<VolumetricFormat, (b: Uint8Array, wholeFile: boolean) => HeaderInfo | null> = {
  cube: cubeHeader, xsf: xsfHeader, chgcar: chgcarHeader,
};

/** Bytes per value over the first ~64 KiB of whole data lines. */
function sampleBytesPerValue(buf: Uint8Array, from: number): number {
  let end = Math.min(buf.length, from + 65536);
  while (end > from && buf[end - 1] !== 0x0A) end--;
  if (end <= from) end = buf.length;
  const text = new TextDecoder().decode(buf.subarray(from, end));
  const n = text.split(/\s+/).filter(t => t !== '' && !Number.isNaN(Number(t))).length;
  return n > 0 ? (end - from) / n : 13;
}

const nearest = (x: number, choices: number[]) =>
  choices.reduce((best, c) => (Math.abs(c - x) < Math.abs(best - x) ? c : best), choices[0]);

export async function probeVolumetric(
  filePath: string,
  filename: string = path.basename(filePath),
  opts: ProbeOptions = {},
): Promise<VolumetricProbe> {
  const format = volumetricFormatOf(filename);
  if (!format) throw new Error(`probe: not a volumetric file name: ${filename}`);
  const maxHeader = opts.maxHeaderBytes ?? 16 << 20;
  const maxPlane = opts.maxPlaneBytes ?? 64 << 20;
  const cap = opts.maxGridPoints ?? VOLUMETRIC_SAFETY_MAX_GRID_POINTS;

  const fh = await fs.promises.open(filePath, 'r');
  try {
    const size = (await fh.stat()).size;
    const r = new HeadReader(fh, size);

    // 1) Grid header.
    let hdr: HeaderInfo | null = null;
    for (let want = 256 << 10; ; want *= 2) {
      await r.ensure(Math.min(want, maxHeader));
      hdr = HEADER_PARSERS[format](r.buf, r.buf.length >= size);
      if (hdr || r.buf.length >= Math.min(maxHeader, size)) break;
    }
    if (!hdr) throw new Error(`probe: ${format} grid header not found in the first ${r.buf.length} bytes`);
    const { dims, dataOffset } = hdr;
    const N = dims[0] * dims[1] * dims[2];

    // 2) Bytes per value → grid-count estimate.
    await r.ensure(dataOffset + 65536);
    const bpv = sampleBytesPerValue(r.buf, dataOffset);
    const perGrid = Math.max(1, (size - dataOffset) / (bpv * N));
    let gridCount = 1, outputGridCount = 1;
    if (format === 'chgcar') {
      gridCount = nearest(perGrid, [1, 2, 4]);         // ISPIN=1 / 2 / non-collinear
      outputGridCount = gridCount === 2 ? 4 : gridCount; // + derived spin_up / spin_down
    } else if (format === 'xsf') {
      gridCount = Math.max(1, Math.round(perGrid));
      outputGridCount = gridCount;
    }

    // 3) XSF periodic-closure planes.
    let skip: [boolean, boolean, boolean] = [false, false, false];
    let endpointSource: VolumetricProbe['endpointSource'] = 'none';
    if (format === 'xsf') {
      const plane = dims[0] * dims[1];
      const planeBytes = Math.ceil(bpv * plane * 1.25) + 4096;
      if (planeBytes <= maxPlane) {
        await r.ensure(dataOffset + planeBytes);
        const first = firstNumbers(r.buf, dataOffset, plane);
        // The tail belongs to the LAST grid, so it only says something about
        // the first grid's z closure when the file holds a single grid.
        let last: Float64Array | null = null;
        if (gridCount === 1) {
          const tailLen = Math.min(size, planeBytes + 65536);
          const tail = await r.readAt(size - tailLen, tailLen);
          const endAt = lastIndexOf(tail, END_DATAGRID);
          if (endAt > 0) last = lastNumbersBefore(tail, endAt, plane);
        }
        const det = detectRedundantEndpointsDetailed(dims, first, last);
        skip = det.skip;
        endpointSource = det.conclusive.every(Boolean) ? 'data' : 'convention';
      } else {
        // Plane too large to read cheaply: XSF spec ("general grid") default.
        skip = [dims[0] > 2, dims[1] > 2, dims[2] > 2];
        endpointSource = 'convention';
      }
    }

    const eff = [0, 1, 2].map(a => (skip[a] ? dims[a] - 1 : dims[a])) as Dims;
    const factor = chooseStride(eff[0], eff[1], eff[2], cap);
    const probe: VolumetricProbe = {
      format,
      fileSize: size,
      dims,
      effectiveDims: eff,
      gridCount,
      gridCountEstimated: format !== 'cube',
      outputGridCount,
      fullResBytes: 4 * eff[0] * eff[1] * eff[2] * outputGridCount,
      recommendedFactor: factor,
      recommendedDims: [0, 0, 0],
      redundantEndpoint: skip,
      endpointSource,
      dataOffset,
      bytesPerValue: bpv,
      bytesRead: 0,
    };
    probe.recommendedDims = dimsForFactor(probe, factor);
    probe.bytesRead = r.bytesRead;
    return probe;
  } finally {
    await fh.close();
  }
}

const END_DATAGRID = new TextEncoder().encode('END_DATAGRID_3D');

function lastIndexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = hay.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
