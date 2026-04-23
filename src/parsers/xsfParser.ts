import { CrystalStructure, CrystalTrajectory, VolumetricData } from './types';
import { getElementByNumber } from '../shared/elements-data';

export function parseXsf(content: string): CrystalStructure & { volumetric?: VolumetricData } {
  const lines = content.split('\n');
  let lattice: [number, number, number][] = [];
  const species: string[] = [];
  const positions: [number, number, number][] = [];
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
          i++; continue;
        }
      }
    }

    i++;
  }

  if (lattice.length === 0) {
    lattice = [[10, 0, 0], [0, 10, 0], [0, 0, 10]];
  }

  // Parse BLOCK_DATAGRID_3D if present
  let volumetric: VolumetricData | undefined;
  const datagridIdx = content.indexOf('BEGIN_BLOCK_DATAGRID_3D');
  if (datagridIdx >= 0) {
    volumetric = parseDatagrid3D(content.slice(datagridIdx));
  }

  return { lattice, species, positions, pbc, title, volumetric };
}

/**
 * v0.17.1.1 — AXSF multi-frame XSF parser.
 *
 * AXSF extends XSF with `ANIMSTEPS N` header and one PRIMCOORD block per
 * frame. The lattice can either be specified once (`PRIMVEC` before all
 * frames, fixed-cell) or per-frame (`PRIMVEC 1`, `PRIMVEC 2`, … numbered
 * blocks, variable-cell).
 *
 * Behavior:
 * - No ANIMSTEPS marker → single-frame trajectory (length 1, latticeMode='fixed').
 * - ANIMSTEPS present, single PRIMVEC → fixed-cell, every frame shares the
 *   same lattice REFERENCE so renderer's cell wireframe doesn't rebuild
 *   per frame.
 * - ANIMSTEPS present, multiple `PRIMVEC k` → variable-cell ('per-frame').
 *
 * Volumetric data on multi-frame AXSF is rare; if present, attached only
 * to frame 0 (CLI/webview consume from frames[0] currently).
 */
export function parseXsfTraj(content: string): { trajectory: CrystalTrajectory; volumetric?: VolumetricData } {
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
    const { volumetric, ...structure } = r;
    return {
      trajectory: { frames: [structure], latticeMode: 'fixed' },
      volumetric,
    };
  }

  // Multi-frame: walk linearly, building lattice + frames as we encounter
  // PRIMVEC / PRIMCOORD blocks.
  let sharedLattice: [number, number, number][] | null = null;
  const perFrameLattices: ([number, number, number][] | null)[] = new Array(animSteps).fill(null);
  const frameAtoms: { species: string[]; positions: [number, number, number][] }[] = [];

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
      }
      // Pad frameAtoms array if frameIdx is out of order
      while (frameAtoms.length <= frameIdx) {
        frameAtoms.push({ species: [], positions: [] });
      }
      frameAtoms[frameIdx] = { species, positions };
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
    frames.push({
      lattice: lat,
      species: frameAtoms[k].species,
      positions: frameAtoms[k].positions,
      pbc,
      title,
    });
  }

  // Volumetric (rare in multi-frame AXSF) — if present, attach only via
  // the parent helper since trajectory itself doesn't carry it.
  let volumetric: VolumetricData | undefined;
  const datagridIdx = content.indexOf('BEGIN_BLOCK_DATAGRID_3D');
  if (datagridIdx >= 0) {
    volumetric = parseDatagrid3D(content.slice(datagridIdx));
  }

  return { trajectory: { frames, latticeMode }, volumetric };
}

function parseDatagrid3D(block: string): VolumetricData | undefined {
  const lines = block.split('\n');
  let i = 0;

  // Find BEGIN_DATAGRID_3D
  while (i < lines.length && !lines[i].trim().startsWith('BEGIN_DATAGRID_3D')) i++;
  if (i >= lines.length) return undefined;
  i++;

  // Grid dimensions
  const dimTokens = lines[i].trim().split(/\s+/).map(Number);
  const nx = dimTokens[0], ny = dimTokens[1], nz = dimTokens[2];
  i++;

  // Origin
  const origTokens = lines[i].trim().split(/\s+/).map(Number);
  const origin: [number, number, number] = [origTokens[0], origTokens[1], origTokens[2]];
  i++;

  // 3 spanning vectors
  const gridLattice: [number, number, number][] = [];
  for (let v = 0; v < 3; v++) {
    const vTokens = lines[i].trim().split(/\s+/).map(Number);
    gridLattice.push([vTokens[0], vTokens[1], vTokens[2]]);
    i++;
  }

  // Data values — XSF writes with ix fastest (Fortran order). Store in C order
  // (ix slowest, iz fastest) so `data[ix*ny*nz + iy*nz + iz]` works downstream.
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

  return { origin, lattice: gridLattice, dims: [nx, ny, nz], data };
}
