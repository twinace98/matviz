/**
 * Synthetic volumetric files for parser / probe / streaming tests (v0.23.1).
 * Each generator returns the full file text; values are periodic Gaussian
 * blobs so downsampling quality can be measured.
 */
type Dims = [number, number, number];

const fmt = (v: number) => v.toExponential(6);

/** Periodic blob value at fractional (fx, fy, fz). */
export function blobValue(fx: number, fy: number, fz: number, c: Dims, sigma = 0.1, sign = 1): number {
  const pd = (f: number, c0: number) => { const x = f - c0; return x - Math.round(x); };
  const x = pd(fx, c[0]), y = pd(fy, c[1]), z = pd(fz, c[2]);
  return sign * Math.exp(-(x * x + y * y + z * z) / (2 * sigma * sigma));
}

function rows(vals: string[], perLine: number): string {
  const out: string[] = [];
  for (let i = 0; i < vals.length; i += perLine) out.push(vals.slice(i, i + perLine).join(' '));
  return out.join('\n');
}

/** Gaussian cube, N³ grid, z fastest, 6 values per line, cell edge L Å. */
export function synthCube(N: number, center: Dims = [0.31, 0.58, 0.77], L = 10): string {
  const h = L / N / 0.529177249;
  const vals: string[] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++)
    vals.push(fmt(blobValue(i / N, j / N, k / N, center)));
  return `gen\nblob\n1 0 0 0\n${N} ${h} 0 0\n${N} 0 ${h} 0\n${N} 0 0 ${h}\n8 8.0 1 1 1\n${rows(vals, 6)}\n`;
}

/**
 * XSF with `grids` DATAGRIDs of N³ points each, x fastest. `closure` = the
 * general-grid convention (last plane duplicates the first; period N − 1).
 */
export function synthXsf(N: number, grids = 1, closure = true, L = 10): string {
  const P = closure ? N - 1 : N;
  let blocks = '';
  for (let g = 0; g < grids; g++) {
    const c: Dims = [0.12 + 0.3 * g, 0.47, 0.93 - 0.2 * g];
    const vals: string[] = [];
    for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
      vals.push(fmt(blobValue((i % P) / P, (j % P) / P, (k % P) / P, c)));
    blocks += `BEGIN_DATAGRID_3D_grid${g}\n${N} ${N} ${N}\n0 0 0\n${L} 0 0\n0 ${L} 0\n0 0 ${L}\n${rows(vals, 6)}\nEND_DATAGRID_3D\n`;
  }
  return `CRYSTAL\nPRIMVEC\n${L} 0 0\n0 ${L} 0\n0 0 ${L}\nPRIMCOORD\n1 1\nO 1 1 1\n` +
    `BEGIN_BLOCK_DATAGRID_3D\nblob\n${blocks}END_BLOCK_DATAGRID_3D\n`;
}

/** CHGCAR with `grids` ∈ {1, 2, 4} blocks of N³ (x fastest, 5 per line) + augmentation sections. */
export function synthChgcar(N: number, grids: 1 | 2 | 4 = 2, L = 10): string {
  const block = (sign: number, c: Dims) => {
    const vals: string[] = [];
    for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
      vals.push(fmt(blobValue(i / N, j / N, k / N, c, 0.1, sign)));
    return rows(vals, 5);
  };
  let body = '';
  for (let g = 0; g < grids; g++) {
    body += `${N} ${N} ${N}\n${block(g === 0 ? 1 : -1, [0.25 + 0.15 * g, 0.25, 0.6])}\n` +
      `augmentation occupancies 1 1\n0.1\n`;
  }
  return `synthetic\n1.0\n${L} 0 0\n0 ${L} 0\n0 0 ${L}\nFe\n1\nDirect\n0 0 0\n\n${body}`;
}
