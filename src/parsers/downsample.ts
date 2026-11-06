/**
 * v0.23.1 — drift-free volumetric downsampling (periodic trilinear resampling).
 *
 * Why not point sampling: the old decimation kept every s-th sample, but the
 * renderer maps grid index → position with `step = L / dims` (periodic,
 * CHGCAR convention). With `dims = ceil(N/s)` and `N % s ≠ 0` the kept samples
 * really sit at `s·L/N` spacing, so the grid was squeezed toward the origin
 * (measured up to 1.7 voxel centroid drift) and the periodic wrap got a seam.
 *
 * Resampling: output node j along an axis sits at source coordinate
 * x = j·N_eff/M (the exact periodic position the renderer will draw it at)
 * and takes the linear interpolation of source samples floor(x) and
 * floor(x)+1 (mod N_eff). Applied per axis this is trilinear interpolation.
 * Chosen over a tent (averaging) splat by user decision 2026-11-06: no
 * position drift and far less peak flattening; the cost is that features
 * narrower than the output voxel can alias.
 *
 * Streaming: interpolation is evaluated "transposed" — every source sample
 * pushes its value into the (at most two, adjacent) output nodes that read
 * it. For M ≤ N_eff each source index is the lower neighbour of at most one
 * output node and the upper neighbour of at most one (its predecessor), so
 * the per-axis map has two slots. The filter is separable: samples
 * accumulate one source row at a time; peak memory = output grid + one row.
 * Values are pushed in file order, so the same resampler serves the
 * in-memory, byte and streaming parsers.
 */

export interface AxisMap {
  /** Source sample count along the axis (as stored in the file). */
  N: number;
  /** Output node count. */
  M: number;
  /** First / second output node fed by each source index. */
  j0: Int32Array;
  j1: Int32Array;
  /** Matching weights (0 = slot unused, e.g. skipped closure sample). */
  w0: Float64Array;
  w1: Float64Array;
  /** Σ of weights landing on each output node (1 up to rounding). */
  wsum: Float64Array;
}

/**
 * Build the 1-D periodic linear-interpolation map from N source samples to
 * M ≤ N_eff output nodes. `skipLast`: the final source sample duplicates
 * sample 0 (XSF "general grid" periodic closure); it is never read and the
 * period is N − 1.
 */
export function makeAxisMap(N: number, M: number, skipLast = false): AxisMap {
  const Neff = skipLast && N > 1 ? N - 1 : N;
  if (M > Neff) throw new Error(`makeAxisMap: upsampling not supported (M=${M} > N=${Neff})`);
  const j0 = new Int32Array(N).fill(-1);
  const j1 = new Int32Array(N).fill(-1);
  const w0 = new Float64Array(N);
  const w1 = new Float64Array(N);
  const wsum = new Float64Array(M);
  const add = (i: number, j: number, w: number) => {
    if (w === 0) return;
    if (j0[i] < 0) { j0[i] = j; w0[i] = w; }
    else if (j1[i] < 0) { j1[i] = j; w1[i] = w; }
    else throw new Error('makeAxisMap: more than two readers per source sample');
    wsum[j] += w;
  };
  for (let j = 0; j < M; j++) {
    // Exact rational position j·Neff/M; integer math keeps exact hits exact,
    // so M = Neff is a bit-exact identity (t = 0 everywhere).
    const num = j * Neff;
    const i0 = Math.floor(num / M);
    const t = (num - i0 * M) / M;
    add(i0, j, 1 - t);
    add(i0 + 1 === Neff ? 0 : i0 + 1, j, t);
  }
  for (let i = 0; i < N; i++) {
    if (j0[i] < 0) j0[i] = 0;
    if (j1[i] < 0) j1[i] = 0;
  }
  return { N, M, j0, j1, w0, w1, wsum };
}

/** Output node count for a source axis at the given integer factor. */
export function outputCount(N: number, factor: number, skipLast = false): number {
  const Neff = skipLast && N > 1 ? N - 1 : N;
  return Math.max(1, Math.ceil(Neff / factor));
}

export type SourceOrder = 'x-fastest' | 'z-fastest';

export interface GridResamplerOptions {
  /** Per-axis (x, y, z) "last sample duplicates the first" flags. */
  skipLast?: [boolean, boolean, boolean];
  /**
   * File order of the pushed samples. 'x-fastest' = XSF / CHGCAR (Fortran);
   * 'z-fastest' = Gaussian cube and the in-memory C-order layout.
   */
  order: SourceOrder;
}

/**
 * Streaming 3-D periodic trilinear downsampler. Push every source sample in
 * file order with `push(v)`; `finish()` returns the output in the renderer's
 * C order (`data[ox·My·Mz + oy·Mz + oz]`, z fastest).
 */
export class GridResampler {
  readonly outDims: [number, number, number];
  private readonly out: Float32Array;
  // Axis maps in stream order (fast, mid, slow) and by physical axis.
  private readonly fast: AxisMap;
  private readonly mid: AxisMap;
  private readonly slow: AxisMap;
  private readonly ax: AxisMap;
  private readonly ay: AxisMap;
  private readonly az: AxisMap;
  // Output index strides for (fast, mid, slow) axes.
  private readonly sFast: number;
  private readonly sMid: number;
  private readonly sSlow: number;
  private readonly row: Float64Array;
  private iF = 0;
  private iM = 0;
  private iS = 0;
  private done = false;

  constructor(
    srcDims: [number, number, number],
    outDims: [number, number, number],
    opts: GridResamplerOptions,
  ) {
    const skip = opts.skipLast ?? [false, false, false];
    const [mx, my, mz] = outDims;
    const ax = makeAxisMap(srcDims[0], mx, skip[0]);
    const ay = makeAxisMap(srcDims[1], my, skip[1]);
    const az = makeAxisMap(srcDims[2], mz, skip[2]);
    this.ax = ax; this.ay = ay; this.az = az;
    const stX = my * mz, stY = mz, stZ = 1;  // C-order output strides
    if (opts.order === 'x-fastest') {
      this.fast = ax; this.mid = ay; this.slow = az;
      this.sFast = stX; this.sMid = stY; this.sSlow = stZ;
    } else {
      this.fast = az; this.mid = ay; this.slow = ax;
      this.sFast = stZ; this.sMid = stY; this.sSlow = stX;
    }
    this.outDims = [mx, my, mz];
    this.out = new Float32Array(mx * my * mz);
    this.row = new Float64Array(this.fast.M);
  }

  /** Push the next source sample (file order). Extra samples are ignored. */
  push(v: number): void {
    if (this.done) return;
    const f = this.fast, i = this.iF;
    const a = f.w0[i], b = f.w1[i];
    if (a !== 0) this.row[f.j0[i]] += a * v;
    if (b !== 0) this.row[f.j1[i]] += b * v;
    if (++this.iF === f.N) {
      this.iF = 0;
      this.flushRow();
      if (++this.iM === this.mid.N) {
        this.iM = 0;
        if (++this.iS === this.slow.N) this.done = true;
      }
    }
  }

  /** True once every source sample has been pushed. */
  get complete(): boolean { return this.done; }

  private flushRow(): void {
    const m = this.mid, s = this.slow, im = this.iM, is = this.iS;
    const mj0 = m.j0[im], mj1 = m.j1[im], mw0 = m.w0[im], mw1 = m.w1[im];
    const sj0 = s.j0[is], sj1 = s.j1[is], sw0 = s.w0[is], sw1 = s.w1[is];
    if ((mw0 === 0 && mw1 === 0) || (sw0 === 0 && sw1 === 0)) { this.row.fill(0); return; }
    const row = this.row, out = this.out, Mf = this.fast.M, sF = this.sFast;
    const mj = [mj0, mj1], mw = [mw0, mw1], sj = [sj0, sj1], sw = [sw0, sw1];
    for (let p = 0; p < 2; p++) {
      if (mw[p] === 0) continue;
      for (let q = 0; q < 2; q++) {
        const w = mw[p] * sw[q];
        if (w === 0) continue;
        const base = mj[p] * this.sMid + sj[q] * this.sSlow;
        for (let jf = 0; jf < Mf; jf++) out[base + jf * sF] += w * row[jf];
      }
    }
    row.fill(0);
  }

  /** Normalize (weights sum to 1 up to rounding) and return the grid. Call once. */
  finish(): Float32Array {
    const [mx, my, mz] = this.outDims;
    const wx = this.ax.wsum, wy = this.ay.wsum, wz = this.az.wsum;
    const out = this.out;
    for (let ox = 0; ox < mx; ox++) {
      for (let oy = 0; oy < my; oy++) {
        const wxy = wx[ox] * wy[oy];
        const base = ox * my * mz + oy * mz;
        for (let oz = 0; oz < mz; oz++) {
          const w = wxy * wz[oz];
          out[base + oz] = w > 0 ? out[base + oz] / w : 0;
        }
      }
    }
    return out;
  }
}

/**
 * Downsample an in-memory C-order grid (z fastest) to `outDims`. Used by the
 * string path; byte/stream parsers drive `GridResampler` directly.
 */
export function resampleGrid(
  data: Float32Array,
  dims: [number, number, number],
  outDims: [number, number, number],
  skipLast?: [boolean, boolean, boolean],
): Float32Array {
  const r = new GridResampler(dims, outDims, { order: 'z-fastest', skipLast });
  for (let i = 0; i < data.length; i++) r.push(data[i]);
  return r.finish();
}

/**
 * Detect XSF "general grid" periodic closure (last plane duplicates the
 * first) per axis WITHOUT the whole grid in memory. Input values are in XSF
 * file order (x fastest): `firstPlane` = the first nx·ny values (z = 0),
 * `lastPlane` = the last nx·ny values (z = nz − 1). x and y are judged on the
 * first plane only; z compares the two planes. Same tolerance rule as the
 * full-volume `trimRedundantPeriodicPlanes` (1e-5 × max |value| seen).
 */
export function detectRedundantEndpoints(
  dims: [number, number, number],
  firstPlane: ArrayLike<number>,
  lastPlane: ArrayLike<number>,
): [boolean, boolean, boolean] {
  const [nx, ny, nz] = dims;
  let maxAbs = 0;
  for (let i = 0; i < firstPlane.length; i++) maxAbs = Math.max(maxAbs, Math.abs(firstPlane[i]));
  for (let i = 0; i < lastPlane.length; i++) maxAbs = Math.max(maxAbs, Math.abs(lastPlane[i]));
  const tol = 1e-5 * (maxAbs || 1);
  const at = (p: ArrayLike<number>, ix: number, iy: number) => p[ix + nx * iy];
  const complete = firstPlane.length >= nx * ny && lastPlane.length >= nx * ny;
  let sx = complete && nx > 2, sy = complete && ny > 2, sz = complete && nz > 2;
  for (let iy = 0; sx && iy < ny; iy++)
    if (Math.abs(at(firstPlane, 0, iy) - at(firstPlane, nx - 1, iy)) > tol) sx = false;
  for (let ix = 0; sy && ix < nx; ix++)
    if (Math.abs(at(firstPlane, ix, 0) - at(firstPlane, ix, ny - 1)) > tol) sy = false;
  for (let k = 0; sz && k < nx * ny; k++)
    if (Math.abs(firstPlane[k] - lastPlane[k]) > tol) sz = false;
  return [sx, sy, sz];
}
