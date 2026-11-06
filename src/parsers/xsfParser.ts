import {
  CrystalStructure, CrystalTrajectory, VolumetricData, AtomVectorField,
  VolumetricLoadOptions, VOLUMETRIC_SAFETY_MAX_GRID_POINTS, chooseStride,
} from './types';
import { getElementByNumber } from '../shared/elements-data';
import { iterLines, iterLineSpans, findBytes, firstNumbers, lastNumbersBefore } from './lineIterator';
import { TentAccumulator, detectRedundantEndpoints, outputCount } from './downsample';

const DATAGRID_MARKER = new TextEncoder().encode('BEGIN_BLOCK_DATAGRID_3D');
const END_DATAGRID_MARKER = new TextEncoder().encode('END_DATAGRID_3D');

/**
 * Auto-detect trailing vector data in a batch of PRIMCOORD/ATOMS atom rows.
 * The XSF spec calls cols 5–7 "atomic forces", but ASE-written XSF reuses the
 * same slots for magnetic moments (collinear → 1 trailing column, non-collinear
 * → 3). We surface them as a generic vector field; the user can interpret the
 * arrows as forces or moments based on their source. Returns null when token
 * counts are mixed or no atom carries trailing data.
 */
function extractAtomVectorsFromRows(rows: string[][]): AtomVectorField | null {
  if (rows.length === 0) return null;
  let minExtra = Infinity;
  for (const r of rows) {
    const extra = r.length - 4;
    if (extra < 0) return null;
    if (extra < minExtra) minExtra = extra;
  }
  if (minExtra >= 3) {
    const values: Array<[number, number, number]> = [];
    for (const r of rows) {
      const mx = parseFloat(r[4]);
      const my = parseFloat(r[5]);
      const mz = parseFloat(r[6]);
      if (!Number.isFinite(mx) || !Number.isFinite(my) || !Number.isFinite(mz)) return null;
      values.push([mx, my, mz]);
    }
    if (values.every(v => Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]) < 1e-8)) return null;
    return { kind: 'generic', label: 'Atomic vector (col 5–7)', values };
  }
  if (minExtra === 1) {
    const values: Array<[number, number, number]> = [];
    for (const r of rows) {
      const m = parseFloat(r[4]);
      if (!Number.isFinite(m)) return null;
      values.push([0, 0, m]);
    }
    if (values.every(v => Math.abs(v[2]) < 1e-8)) return null;
    return { kind: 'generic', label: 'Atomic scalar (col 5, along z)', values };
  }
  return null;
}

export function parseXsf(content: string): CrystalStructure & { volumetric?: VolumetricData; volumetrics?: VolumetricData[] } {
  const lines = content.split('\n');
  let lattice: [number, number, number][] = [];
  const species: string[] = [];
  const positions: [number, number, number][] = [];
  const atomRows: string[][] = [];
  let pbc: [boolean, boolean, boolean] = [false, false, false];
  let title = '';

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === 'CRYSTAL') {
      pbc = [true, true, true];
      i++; continue;
    }
    if (line === 'SLAB') {
      pbc = [true, true, false];
      i++; continue;
    }
    if (line === 'POLYMER') {
      pbc = [true, false, false];
      i++; continue;
    }
    if (line === 'MOLECULE' || line === 'ATOMS') {
      pbc = [false, false, false];
      i++; continue;
    }

    if (line === 'PRIMVEC' || line === 'CONVVEC') {
      lattice = [];
      for (let j = 1; j <= 3; j++) {
        const vals = lines[i + j].trim().split(/\s+/).map(Number);
        lattice.push([vals[0], vals[1], vals[2]]);
      }
      i += 4; continue;
    }

    if (line.startsWith('PRIMCOORD') || line.startsWith('CONVCOORD')) {
      i++;
      const header = lines[i].trim().split(/\s+/);
      const natoms = parseInt(header[0]);
      i++;

      for (let j = 0; j < natoms; j++) {
        const tokens = lines[i + j].trim().split(/\s+/);
        const first = tokens[0];

        // First token can be atomic number or element symbol
        let symbol: string;
        if (/^\d+$/.test(first)) {
          symbol = getElementByNumber(parseInt(first)).symbol;
        } else {
          symbol = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
        }

        species.push(symbol);
        positions.push([
          parseFloat(tokens[1]),
          parseFloat(tokens[2]),
          parseFloat(tokens[3]),
        ]);
        atomRows.push(tokens);
      }
      i += natoms; continue;
    }

    // Non-periodic ATOMS section (just atom lines without header)
    if (line && !line.startsWith('#') && !line.startsWith('_') && species.length === 0) {
      const tokens = line.split(/\s+/);
      if (tokens.length >= 4) {
        const first = tokens[0];
        if (/^\d+$/.test(first) || /^[A-Z][a-z]?$/.test(first)) {
          let symbol: string;
          if (/^\d+$/.test(first)) {
            symbol = getElementByNumber(parseInt(first)).symbol;
          } else {
            symbol = first;
          }
          species.push(symbol);
          positions.push([parseFloat(tokens[1]), parseFloat(tokens[2]), parseFloat(tokens[3])]);
          atomRows.push(tokens);
          i++; continue;
        }
      }
    }

    i++;
  }

  if (lattice.length === 0) {
    lattice = [[10, 0, 0], [0, 10, 0], [0, 0, 10]];
  }

  // Parse BLOCK_DATAGRID_3D if present. v0.23.2: collect ALL grids across
  // all BEGIN_DATAGRID_3D blocks (multiple exciton states / band-decomposed
  // densities), each named from its label line.
  let volumetric: VolumetricData | undefined;
  let volumetrics: VolumetricData[] | undefined;
  const datagridIdx = content.indexOf('BEGIN_BLOCK_DATAGRID_3D');
  if (datagridIdx >= 0) {
    const grids = parseDatagrids3D(content.slice(datagridIdx));
    for (const g of grids) snapGridLatticeToCell(g, lattice);
    if (grids.length > 0) { volumetrics = grids; volumetric = grids[0]; }
  }

  const atomVectors = extractAtomVectorsFromRows(atomRows) ?? undefined;

  return { lattice, species, positions, pbc, title, volumetric, volumetrics, atomVectors };
}

/**
 * AXSF multi-frame parser. AXSF extends XSF with `ANIMSTEPS N` plus one
 * PRIMCOORD block per frame; lattice is either specified once (fixed-cell)
 * or as numbered `PRIMVEC k` blocks (per-frame). Fixed-cell frames share
 * the same lattice reference so the renderer's cell wireframe doesn't
 * rebuild per frame.
 */
export function parseXsfTraj(content: string): { trajectory: CrystalTrajectory; volumetric?: VolumetricData; volumetrics?: VolumetricData[] } {
  const lines = content.split('\n');
  let pbc: [boolean, boolean, boolean] = [true, true, true];
  let title = '';

  // First scan: detect ANIMSTEPS + crystal type
  let animSteps = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('ANIMSTEPS')) {
      const tokens = line.split(/\s+/);
      animSteps = parseInt(tokens[1] || '0');
    }
    if (line === 'SLAB') pbc = [true, true, false];
    else if (line === 'POLYMER') pbc = [true, false, false];
    else if (line === 'MOLECULE' || line === 'ATOMS') pbc = [false, false, false];
  }

  if (animSteps <= 1) {
    // Single-frame: delegate to parseXsf and wrap.
    const r = parseXsf(content);
    const { volumetric, volumetrics, ...structure } = r;
    return {
      trajectory: { frames: [structure], latticeMode: 'fixed' },
      volumetric,
      volumetrics,
    };
  }

  // Multi-frame: walk linearly, building lattice + frames as we encounter
  // PRIMVEC / PRIMCOORD blocks.
  let sharedLattice: [number, number, number][] | null = null;
  const perFrameLattices: ([number, number, number][] | null)[] = new Array(animSteps).fill(null);
  const frameAtoms: { species: string[]; positions: [number, number, number][]; rows: string[][] }[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.startsWith('PRIMVEC') || line.startsWith('CONVVEC')) {
      // Detect optional frame index: "PRIMVEC 1" → per-frame
      const tokens = line.split(/\s+/);
      const lat: [number, number, number][] = [];
      for (let j = 1; j <= 3; j++) {
        const vals = lines[i + j].trim().split(/\s+/).map(Number);
        lat.push([vals[0], vals[1], vals[2]]);
      }
      if (tokens.length > 1 && /^\d+$/.test(tokens[1])) {
        const idx = parseInt(tokens[1]) - 1; // 1-based to 0-based
        if (idx >= 0 && idx < animSteps) perFrameLattices[idx] = lat;
      } else {
        sharedLattice = lat;
      }
      i += 4; continue;
    }

    if (line.startsWith('PRIMCOORD') || line.startsWith('CONVCOORD')) {
      const tokens = line.split(/\s+/);
      const frameIdx = tokens.length > 1 && /^\d+$/.test(tokens[1])
        ? parseInt(tokens[1]) - 1
        : frameAtoms.length;
      i++;
      const header = lines[i].trim().split(/\s+/);
      const natoms = parseInt(header[0]);
      i++;

      const species: string[] = [];
      const positions: [number, number, number][] = [];
      const rows: string[][] = [];
      for (let j = 0; j < natoms; j++) {
        const lineTokens = lines[i + j].trim().split(/\s+/);
        const first = lineTokens[0];
        let symbol: string;
        if (/^\d+$/.test(first)) {
          symbol = getElementByNumber(parseInt(first)).symbol;
        } else {
          symbol = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
        }
        species.push(symbol);
        positions.push([
          parseFloat(lineTokens[1]),
          parseFloat(lineTokens[2]),
          parseFloat(lineTokens[3]),
        ]);
        rows.push(lineTokens);
      }
      // Pad frameAtoms array if frameIdx is out of order
      while (frameAtoms.length <= frameIdx) {
        frameAtoms.push({ species: [], positions: [], rows: [] });
      }
      frameAtoms[frameIdx] = { species, positions, rows };
      i += natoms; continue;
    }

    i++;
  }

  // Resolve lattice mode
  const hasPerFrameLattice = perFrameLattices.some(l => l !== null);
  const latticeMode: 'fixed' | 'per-frame' = hasPerFrameLattice ? 'per-frame' : 'fixed';

  const fallback: [number, number, number][] = sharedLattice || [[10,0,0],[0,10,0],[0,0,10]];

  // Build frames; share lattice ref when fixed (renderer optimization
  // depends on object identity).
  const frames: CrystalStructure[] = [];
  for (let k = 0; k < animSteps; k++) {
    if (!frameAtoms[k] || frameAtoms[k].species.length === 0) continue;
    const lat = hasPerFrameLattice
      ? (perFrameLattices[k] || sharedLattice || fallback)
      : fallback;
    const atomVectors = extractAtomVectorsFromRows(frameAtoms[k].rows) ?? undefined;
    frames.push({
      lattice: lat,
      species: frameAtoms[k].species,
      positions: frameAtoms[k].positions,
      pbc,
      title,
      atomVectors,
    });
  }

  // Volumetric (rare in multi-frame AXSF) — if present, attach only via
  // the parent helper since trajectory itself doesn't carry it.
  let volumetric: VolumetricData | undefined;
  let volumetrics: VolumetricData[] | undefined;
  const datagridIdx = content.indexOf('BEGIN_BLOCK_DATAGRID_3D');
  if (datagridIdx >= 0) {
    const grids = parseDatagrids3D(content.slice(datagridIdx));
    if (frames[0]) for (const g of grids) snapGridLatticeToCell(g, frames[0].lattice);
    if (grids.length > 0) { volumetrics = grids; volumetric = grids[0]; }
  }

  return { trajectory: { frames, latticeMode }, volumetric, volumetrics };
}

/**
 * v0.23.2 — parse EVERY `BEGIN_DATAGRID_3D` block found in `block` (which
 * spans from the first `BEGIN_BLOCK_DATAGRID_3D` to end-of-file, so it may
 * contain several DATAGRID blocks and even several BLOCK sections). Each
 * grid is named from the label suffix on its BEGIN line
 * (`BEGIN_DATAGRID_3D_<label>` → `<label>`; falls back to `datagrid_N`).
 * Returns [] when no well-formed grid is present.
 */
function parseDatagrids3D(block: string): VolumetricData[] {
  const lines = block.split('\n');
  const grids: VolumetricData[] = [];
  let i = 0;
  let gridCount = 0;

  while (i < lines.length) {
    // Advance to the next BEGIN_DATAGRID_3D (skips block names, END markers,
    // blank lines between grids).
    while (i < lines.length && !lines[i].trim().startsWith('BEGIN_DATAGRID_3D')) i++;
    if (i >= lines.length) break;
    gridCount++;
    const beginLine = lines[i].trim();
    const label = beginLine.slice('BEGIN_DATAGRID_3D'.length).replace(/^_+/, '').trim()
      || `datagrid_${gridCount}`;
    i++;

    // Need dims + origin + 3 spanning vectors before data.
    if (i + 4 > lines.length) break;
    const dimTokens = lines[i++].trim().split(/\s+/).map(Number);
    const nx = dimTokens[0], ny = dimTokens[1], nz = dimTokens[2];
    if (!(nx > 0 && ny > 0 && nz > 0)) continue;  // malformed header → skip grid

    const origTokens = lines[i++].trim().split(/\s+/).map(Number);
    const origin: [number, number, number] = [origTokens[0] || 0, origTokens[1] || 0, origTokens[2] || 0];

    const gridLattice: [number, number, number][] = [];
    for (let v = 0; v < 3; v++) {
      const vTokens = lines[i++].trim().split(/\s+/).map(Number);
      gridLattice.push([vTokens[0], vTokens[1], vTokens[2]]);
    }

    // Data values — XSF writes with ix fastest (Fortran order). Store in C
    // order (ix slowest, iz fastest) so `data[ix*ny*nz + iy*nz + iz]` works.
    const totalPoints = nx * ny * nz;
    const data = new Float32Array(totalPoints);
    let ix = 0, iy = 0, iz = 0;
    let count = 0;
    while (i < lines.length && count < totalPoints) {
      const line = lines[i].trim();
      if (line.startsWith('END_DATAGRID_3D') || line.startsWith('END_BLOCK_DATAGRID_3D')) break;
      const tokens = line.split(/\s+/);
      for (const t of tokens) {
        if (count < totalPoints && t !== '') {
          data[ix * ny * nz + iy * nz + iz] = parseFloat(t);
          count++;
          ix++;
          if (ix === nx) { ix = 0; iy++; if (iy === ny) { iy = 0; iz++; } }
        }
      }
      i++;
    }

    const grid = trimRedundantPeriodicPlanes({ origin, lattice: gridLattice, dims: [nx, ny, nz], data });
    grid.name = label;
    grids.push(grid);
    // Loop continues: outer scan skips this grid's END marker to the next BEGIN.
  }

  // Cross-block consistency check (manual: "cell vector가 서로 다르면 오류").
  // We tolerate differing grids here (each renders independently) but warn via
  // dims mismatch only when a caller needs identical framing; sign/geometry is
  // validated downstream. Keeping all grids is the intended multi-grid behavior.
  return grids;
}

/**
 * Drop the duplicated boundary plane of an XSF "general datagrid".
 *
 * XCrySDen/PWSCF/Wannier90 write the periodic-closure grid point on BOTH ends
 * of each spanning direction, so `data[0] == data[N-1]` along that axis and the
 * true number of sampling intervals is `N-1`, not `N`. matviz's marching cubes
 * uses `step = lattice / N` with a periodic wrap (index `N -> 0`) — the CHGCAR
 * convention of `N` non-redundant points spanning `N` intervals. Feeding a
 * general-grid array in unchanged squeezes the whole density by `N/(N-1)` toward
 * the origin (~2.4% for a 41-point axis, ~1.5% for 65), so the iso mesh no
 * longer sits on the atoms.
 *
 * Fix: detect the duplicated boundary plane per axis and drop it, leaving `N-1`
 * non-redundant points that `lattice/(N-1)` step + pbc wrap render exactly onto
 * the cell. Detection is data-driven (planes compared within a relative
 * tolerance), so a genuinely non-redundant sub-region grid is left untouched.
 * The spanning vectors are unchanged — they still describe the full cell edge,
 * which after trimming is spanned by `N-1` intervals as it should be.
 */
function trimRedundantPeriodicPlanes(vd: VolumetricData): VolumetricData {
  const [nx, ny, nz] = vd.dims;
  const d = vd.data;
  const at = (ix: number, iy: number, iz: number) => d[ix * ny * nz + iy * nz + iz];

  let maxAbs = 0;
  for (let k = 0; k < d.length; k++) { const a = Math.abs(d[k]); if (a > maxAbs) maxAbs = a; }
  const tol = 1e-5 * (maxAbs || 1);

  const planesEqualX = () => {
    for (let iy = 0; iy < ny; iy++) for (let iz = 0; iz < nz; iz++)
      if (Math.abs(at(0, iy, iz) - at(nx - 1, iy, iz)) > tol) return false;
    return true;
  };
  const planesEqualY = () => {
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++)
      if (Math.abs(at(ix, 0, iz) - at(ix, ny - 1, iz)) > tol) return false;
    return true;
  };
  const planesEqualZ = () => {
    for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++)
      if (Math.abs(at(ix, iy, 0) - at(ix, iy, nz - 1)) > tol) return false;
    return true;
  };

  const trimX = nx > 2 && planesEqualX();
  const trimY = ny > 2 && planesEqualY();
  const trimZ = nz > 2 && planesEqualZ();
  if (!trimX && !trimY && !trimZ) return vd;

  const Nx = trimX ? nx - 1 : nx;
  const Ny = trimY ? ny - 1 : ny;
  const Nz = trimZ ? nz - 1 : nz;
  const out = new Float32Array(Nx * Ny * Nz);
  for (let ix = 0; ix < Nx; ix++)
    for (let iy = 0; iy < Ny; iy++)
      for (let iz = 0; iz < Nz; iz++)
        out[ix * Ny * Nz + iy * Nz + iz] = at(ix, iy, iz);

  return { origin: vd.origin, lattice: vd.lattice, dims: [Nx, Ny, Nz], data: out };
}

/**
 * Re-anchor a volumetric datagrid's lattice to the crystal cell so the iso
 * mesh aligns with the atoms.
 *
 * XSF writers disagree on what the three datagrid "spanning vectors" mean
 * relative to the `dims = N` grid points. The data itself is periodic over the
 * crystal cell, sampled on an FFT grid that divides the cell into N parts, so
 * the physically correct voxel step is always `cell / N`. But the written
 * spanning vector encodes a per-writer off-by-one:
 *
 *   - VASP-CHGCAR-like / pp.x          span = cell           (N intervals)
 *   - Wannier90 (plot.F90)             span = cell·(N+1)/N   (writes the extra
 *                                        periodic-closure interval into the span)
 *
 * Downstream rendering uses `step = lattice / dims` with periodic marching
 * cubes, so feeding the *written* span makes a Wannier90 grid render N/(N+1)·…
 * = e.g. 1/40 ≈ 2.5% too large, overshooting the atom cell.
 *
 * Fix: when the datagrid clearly spans the whole cell (origin at ~0 and each
 * spanning vector parallel to the matching cell vector with a length ratio near
 * 1, i.e. (N±1)/N), snap the iso lattice to the crystal cell. This is an exact
 * no-op for span == cell, and corrects the (N+1)/N writers. Grids that cover a
 * genuine sub-region (offset origin or a length ratio far from 1) are left
 * untouched so partial-cell plots keep their own extent.
 */
function snapGridLatticeToCell(
  vd: VolumetricData,
  cell: [number, number, number][],
): void {
  if (cell.length !== 3) return;
  const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
  const cellScale = Math.max(len(cell[0]), len(cell[1]), len(cell[2])) || 1;

  // Origin must be at the cell corner (sub-region grids carry an offset).
  if (len(vd.origin) > 1e-3 * cellScale) return;

  for (let i = 0; i < 3; i++) {
    const g = vd.lattice[i];
    const c = cell[i];
    const gl = len(g), cl = len(c);
    if (gl === 0 || cl === 0) return;
    // Parallel? |g × c| / (|g||c|) ~ 0
    const cx = g[1] * c[2] - g[2] * c[1];
    const cy = g[2] * c[0] - g[0] * c[2];
    const cz = g[0] * c[1] - g[1] * c[0];
    if (len([cx, cy, cz]) / (gl * cl) > 1e-3) return;
    // Length ratio within ~(N±1)/N for any reasonable N (N>=3 => within 1±1/3).
    const ratio = gl / cl;
    if (ratio < 0.66 || ratio > 1.51) return;
  }

  // All axes qualify — anchor the iso grid to the crystal cell.
  vd.lattice = [
    [cell[0][0], cell[0][1], cell[0][2]],
    [cell[1][0], cell[1][1], cell[1][2]],
    [cell[2][0], cell[2][1], cell[2][2]],
  ];
}

/**
 * Byte-path single-frame XSF parser (v0.22 Tier 2). Use when the file is
 * too large to materialize as a single JS string (V8 ceiling ~512 MiB).
 * Header portion is decoded as a small string and fed to the existing
 * `parseXsf` (structure / atoms / lattice unchanged); only the DATAGRID
 * grid blob is processed line-by-line over the byte buffer.
 */
export function parseXsfFromBytes(
  bytes: Uint8Array,
  options?: VolumetricLoadOptions,
): CrystalStructure & { volumetric?: VolumetricData; volumetrics?: VolumetricData[] } {
  const datagridOffset = findBytes(bytes, DATAGRID_MARKER);
  if (datagridOffset < 0) {
    return parseXsf(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
  }
  const headerStr = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, datagridOffset));
  const header = parseXsf(headerStr);
  const grids = parseDatagrids3DFromBytes(bytes.subarray(datagridOffset), options);
  for (const g of grids) snapGridLatticeToCell(g, header.lattice);
  return { ...header, volumetric: grids[0], volumetrics: grids.length > 0 ? grids : undefined };
}

/**
 * v0.23.2 byte-path multi-grid parser. Streams the byte block once,
 * finalizing each grid at its `END_DATAGRID_3D` and resuming the scan for
 * the next `BEGIN_DATAGRID_3D` (handles multiple grids and multiple BLOCK
 * sections). Downsampling (v0.23.1 tent splat) is applied per grid during
 * ingestion. At factor 1 the full grid is read and the existing full-volume
 * `trimRedundantPeriodicPlanes` runs; at factor > 1 the periodic-closure
 * planes are detected up front from the first/last data planes and given
 * zero weight, so the output stays on the true periodic lattice.
 */
function parseDatagrids3DFromBytes(blockBytes: Uint8Array, options?: VolumetricLoadOptions): VolumetricData[] {
  const cap = options?.maxGridPoints ?? VOLUMETRIC_SAFETY_MAX_GRID_POINTS;
  const grids: VolumetricData[] = [];
  let gridCount = 0;

  let stage: 'find-begin' | 'dims' | 'origin' | 'vec1' | 'vec2' | 'vec3' | 'data' = 'find-begin';
  let label = '';
  let nx = 0, ny = 0, nz = 0;
  let origin: [number, number, number] = [0, 0, 0];
  let gridLattice: [number, number, number][] = [];
  let data: Float32Array | null = null;
  let stride = 1, outNx = 0, outNy = 0, outNz = 0, totalPoints = 0;
  let ix = 0, iy = 0, iz = 0, count = 0;
  let acc: TentAccumulator | null = null;

  const finalize = () => {
    if (acc) { data = acc.finish(); acc = null; }
    if (!data) return;
    const result: VolumetricData = { origin, lattice: gridLattice, dims: [outNx, outNy, outNz], data };
    let out: VolumetricData;
    if (stride > 1) {
      result.stride = stride;
      result.originalDims = [nx, ny, nz];
      out = result;
    } else {
      out = trimRedundantPeriodicPlanes(result);
    }
    out.name = label || `datagrid_${gridCount}`;
    grids.push(out);
    // reset per-grid state for the next block
    data = null; gridLattice = []; origin = [0, 0, 0]; stride = 1; count = 0; ix = iy = iz = 0;
  };

  for (const { line: rawLine, next } of iterLineSpans(blockBytes)) {
    const line = rawLine.trim();
    if (stage === 'find-begin') {
      if (line.startsWith('BEGIN_DATAGRID_3D')) {
        gridCount++;
        label = line.slice('BEGIN_DATAGRID_3D'.length).replace(/^_+/, '').trim();
        stage = 'dims';
      }
      continue;
    }
    if (stage === 'dims') {
      const t = line.split(/\s+/).map(Number);
      nx = t[0]; ny = t[1]; nz = t[2];
      totalPoints = nx * ny * nz;
      stride = chooseStride(nx, ny, nz, cap);
      stage = 'origin';
      continue;
    }
    if (stage === 'origin') {
      const t = line.split(/\s+/).map(Number);
      origin = [t[0] || 0, t[1] || 0, t[2] || 0];
      stage = 'vec1';
      continue;
    }
    if (stage === 'vec1' || stage === 'vec2' || stage === 'vec3') {
      const t = line.split(/\s+/).map(Number);
      gridLattice.push([t[0], t[1], t[2]]);
      stage = stage === 'vec1' ? 'vec2' : stage === 'vec2' ? 'vec3' : 'data';
      if (stage === 'data') {
        if (stride > 1) {
          // Probe the periodic-closure planes before splatting: the first
          // plane follows this line, the last one precedes END_DATAGRID_3D.
          const endAt = findBytes(blockBytes, END_DATAGRID_MARKER, next);
          const plane = nx * ny;
          const skip = endAt > 0
            ? detectRedundantEndpoints([nx, ny, nz], firstNumbers(blockBytes, next, plane), lastNumbersBefore(blockBytes, endAt, plane))
            : [false, false, false] as [boolean, boolean, boolean];
          const neff = (n: number, k: boolean) => (k && n > 1 ? n - 1 : n);
          stride = Math.max(1, chooseStride(neff(nx, skip[0]), neff(ny, skip[1]), neff(nz, skip[2]), cap));
          outNx = outputCount(nx, stride, skip[0]);
          outNy = outputCount(ny, stride, skip[1]);
          outNz = outputCount(nz, stride, skip[2]);
          acc = new TentAccumulator([nx, ny, nz], [outNx, outNy, outNz], { order: 'x-fastest', skipLast: skip });
        }
        if (!acc) {
          stride = 1;
          outNx = nx; outNy = ny; outNz = nz;
          data = new Float32Array(nx * ny * nz);
        }
      }
      continue;
    }
    // stage === 'data'
    if (line.startsWith('END_DATAGRID_3D') || line.startsWith('END_BLOCK_DATAGRID_3D')) {
      finalize();
      stage = 'find-begin';
      continue;
    }
    if (count >= totalPoints) continue;  // trailing tokens before END — ignore
    const tokens = line.split(/\s+/);
    for (const t of tokens) {
      if (count >= totalPoints || t === '') continue;
      // Source ordering (XSF Fortran): ix fastest in the file stream;
      // storage is C order (iz fastest in memory).
      if (acc) acc.push(parseFloat(t));
      else data![ix * ny * nz + iy * nz + iz] = parseFloat(t);
      count++;
      ix++;
      if (ix === nx) { ix = 0; iy++; if (iy === ny) { iy = 0; iz++; } }
    }
  }
  // Finalize a trailing grid if the stream ended without an END marker.
  if (stage === 'data') finalize();
  return grids;
}
