/**
 * v0.23.1 — artifact-free volumetric downsampling ("tent" / linear splat).
 *
 * Why not point sampling: the old decimation kept every s-th sample, but the
 * renderer maps grid index → position with `step = L / dims` (periodic,
 * CHGCAR convention). With `dims = ceil(N/s)` and `N % s ≠ 0` the kept samples
 * really sit at `s·L/N` spacing, so the grid was squeezed toward the origin
 * (measured up to 1.7 voxel centroid drift) and the periodic wrap got a seam.
 *
 * Tent splat: each source sample i (periodic position i/N_eff of the cell)
 * lands at output coordinate x = i·M/N_eff and is shared between output nodes
 * floor(x) and floor(x)+1 (mod M) with linear weights. Output value =
 * Σ w·v / Σ w. This is the transpose of linear interpolation: it keeps the
 * output on the exact periodic lattice the renderer assumes, preserves the
 * mean density, and low-pass filters (no aliasing of sharp features).
 *
 * The filter is separable, so per-axis weight sums normalize the result
 * (no 3-D weight array) and samples are accumulated one source row at a time:
 * peak memory = output grid + one row buffer. Values are pushed in file
 * order, so the same accumulator serves the in-memory, byte and streaming
 * parsers.
 */

export interface AxisMap {
  /** Source sample count along the axis (as stored in the file). */
  N: number;
  /** Output node count. */
  M: number;
  /** Lower output node for each source index. */
  j0: Int32Array;
  /** Weight of node j0 (node (j0+1) mod M gets 1 − w0). 0 for skipped samples. */
  w0: Float32Array;
  /** Weight of node (j0+1) mod M. */
  w1: Float32Array;
  /** Σ of weights landing on each output node (normalizer). */
  wsum: Float64Array;
}

/**
 * Build the 1-D periodic tent map from N source samples to M output nodes.
 * `skipLast`: the final source sample duplicates sample 0 (XSF "general
 * grid" periodic closure); it gets zero weight and the period is N − 1.
 */
export function makeAxisMap(N: number, M: number, skipLast = false): AxisMap {
  const Neff = skipLast && N > 1 ? N - 1 : N;
  const j0 = new Int32Array(N);
  const w0 = new Float32Array(N);
  const w1 = new Float32Array(N);
  const wsum = new Float64Array(M);
  for (let i = 0; i < N; i++) {
    if (i >= Neff) { j0[i] = 0; w0[i] = 0; w1[i] = 0; continue; }
    // Exact rational position: i·M/Neff. Integer arithmetic keeps exact
    // node hits (t = 0) exact, so M = Neff is a bit-exact identity.
    const num = i * M;
    const j = Math.floor(num / Neff);
    const t = (num - j * Neff) / Neff;
    j0[i] = j;
    w0[i] = 1 - t;
    w1[i] = t;
    wsum[j] += 1 - t;
    wsum[(j + 1) % M] += t;
  }
  return { N, M, j0, w0, w1, wsum };
}

/** Output node count for a source axis at the given integer factor. */
export function outputCount(N: number, factor: number, skipLast = false): number {
  const Neff = skipLast && N > 1 ? N - 1 : N;
  return Math.max(1, Math.ceil(Neff / factor));
}

export type SourceOrder = 'x-fastest' | 'z-fastest';

export interface TentAccumulatorOptions {
  /** Per-axis (x, y, z) "last sample duplicates the first" flags. */
  skipLast?: [boolean, boolean, boolean];
  /**
   * File order of the pushed samples. 'x-fastest' = XSF / CHGCAR (Fortran);
   * 'z-fastest' = Gaussian cube and the in-memory C-order layout.
   */
  order: SourceOrder;
}

/**
 * Streaming 3-D tent downsampler. Push every source sample in file order with
 * `push(v)`; `finish()` returns the normalized output in the renderer's
 * C order (`data[ox·My·Mz + oy·Mz + oz]`, z fastest).
 */
export class TentAccumulator {
  readonly outDims: [number, number, number];
  private readonly out: Float32Array;
  // Axis maps in stream order: fast, mid, slow.
  private readonly fast: AxisMap;
  private readonly mid: AxisMap;
  private readonly slow: AxisMap;
  // Same maps by physical axis (normalization in finish()).
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
    opts: TentAccumulatorOptions,
  ) {
    const skip = opts.skipLast ?? [false, false, false];
    const [mx, my, mz] = outDims;
    const ax = makeAxisMap(srcDims[0], mx, skip[0]);
    const ay = makeAxisMap(srcDims[1], my, skip[1]);
    const az = makeAxisMap(srcDims[2], mz, skip[2]);
    this.ax = ax; this.ay = ay; this.az = az;
    // C-order output strides per physical axis.
    const stX = my * mz, stY = mz, stZ = 1;
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
    if (b !== 0) {
      const j1 = f.j0[i] + 1;
      this.row[j1 === f.M ? 0 : j1] += b * v;
    }
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
    const row = this.row, out = this.out, Mf = this.fast.M, sF = this.sFast;
    const mj = [m.j0[im], m.j0[im] + 1 === m.M ? 0 : m.j0[im] + 1];
    const mw = [m.w0[im], m.w1[im]];
    const sj = [s.j0[is], s.j0[is] + 1 === s.M ? 0 : s.j0[is] + 1];
    const sw = [s.w0[is], s.w1[is]];
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

  /** Normalize and return the output grid (C order). Call once. */
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
 * string path; byte/stream parsers drive `TentAccumulator` directly.
 */
export function tentDownsample(
  data: Float32Array,
  dims: [number, number, number],
  outDims: [number, number, number],
  skipLast?: [boolean, boolean, boolean],
): Float32Array {
  const acc = new TentAccumulator(dims, outDims, { order: 'z-fastest', skipLast });
  for (let i = 0; i < data.length; i++) acc.push(data[i]);
  return acc.finish();
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
  let sx = nx > 2, sy = ny > 2, sz = nz > 2;
  for (let iy = 0; sx && iy < ny; iy++)
    if (Math.abs(at(firstPlane, 0, iy) - at(firstPlane, nx - 1, iy)) > tol) sx = false;
  for (let ix = 0; sy && ix < nx; ix++)
    if (Math.abs(at(firstPlane, ix, 0) - at(firstPlane, ix, ny - 1)) > tol) sy = false;
  for (let k = 0; sz && k < nx * ny; k++)
    if (Math.abs(firstPlane[k] - lastPlane[k]) > tol) sz = false;
  return [sx, sy, sz];
}
