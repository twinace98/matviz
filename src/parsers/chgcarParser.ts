import {
  CrystalStructure, VolumetricData,
  VolumetricLoadOptions, VOLUMETRIC_SAFETY_MAX_GRID_POINTS, chooseStride,
} from './types';
import { parsePoscar } from './poscarParser';
import { GridResampler } from './downsample';
import { iterLines, offsetAfterLines } from './lineIterator';

/**
 * v0.23.3 — classify raw CHGCAR grid blocks into named volumetric grids.
 *
 * VASP block-count semantics:
 *   1 → non-spin: [charge]
 *   2 → collinear spin: [charge=(up+down), magnetization=(up−down)]
 *        + derived spin_up=(c+m)/2, spin_down=(c−m)/2
 *   4 → SOC / non-collinear: [charge, magnetization_x/y/z (σ₁/σ₂/σ₃)]
 *
 * `scale` (= 1/cellVolume) is applied to every grid (CHGCAR stores ρ·V).
 * Magnetization / σ grids are tagged `kind:'signed'` so v0.24 defaults them
 * to ± isosurfaces. spin_up/down are derived eagerly (see impl note): simple,
 * matches the manual's 4-entry Model Tree, and memory is bounded by the
 * v0.22 `maxGridPoints` decimation applied upstream.
 */
function buildChgcarGrids(
  rawGrids: Float32Array[],
  lattice: [number, number, number][],
  dims: [number, number, number],
  scale: number,
  stride?: number,
  originalDims?: [number, number, number],
): VolumetricData[] {
  if (rawGrids.length === 0) return [];
  const norm = (a: Float32Array): Float32Array => {
    const b = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) b[i] = a[i] * scale;
    return b;
  };
  const mk = (name: string, kind: 'scalar' | 'signed', arr: Float32Array): VolumetricData => {
    const g: VolumetricData = { origin: [0, 0, 0], lattice, dims, data: arr, name, kind };
    if (stride && stride > 1) { g.stride = stride; g.originalDims = originalDims; }
    return g;
  };
  if (rawGrids.length >= 4) {
    return [
      mk('charge', 'scalar', norm(rawGrids[0])),
      mk('magnetization_x', 'signed', norm(rawGrids[1])),
      mk('magnetization_y', 'signed', norm(rawGrids[2])),
      mk('magnetization_z', 'signed', norm(rawGrids[3])),
    ];
  }
  if (rawGrids.length === 2) {
    const c = norm(rawGrids[0]);
    const m = norm(rawGrids[1]);
    const up = new Float32Array(c.length);
    const dn = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) { up[i] = (c[i] + m[i]) / 2; dn[i] = (c[i] - m[i]) / 2; }
    return [
      mk('charge', 'scalar', c),
      mk('magnetization', 'signed', m),
      mk('spin_up', 'scalar', up),
      mk('spin_down', 'scalar', dn),
    ];
  }
  // 1 (or an unexpected 3) → treat the first block as total charge only.
  return [mk('charge', 'scalar', norm(rawGrids[0]))];
}

/** Does a trimmed line encode exactly the grid dims `nx ny nz`? Used to find
 * the start of each subsequent CHGCAR grid block past the augmentation
 * sections that separate them. */
function isDimsLine(line: string, nx: number, ny: number, nz: number): boolean {
  const t = line.split(/\s+/);
  return t.length === 3 && t.every(x => /^\d+$/.test(x)) &&
    +t[0] === nx && +t[1] === ny && +t[2] === nz;
}

/** Cell volume |a · (b × c)| from lattice rows. */
function cellVolume(lat: [number, number, number][]): number {
  const a = lat[0], b = lat[1], c = lat[2];
  return Math.abs(
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  );
}

export function parseChgcar(content: string): { structure: CrystalStructure; volumetric?: VolumetricData; volumetrics?: VolumetricData[] } {
  // CHGCAR = POSCAR header + blank line + grid dimensions + charge data
  const lines = content.split('\n');

  // Find the blank line separating POSCAR from charge data
  // POSCAR ends after atom coordinates, then optional blank line, then grid line
  let poscarEnd = -1;
  let atomsStarted = false;
  let atomCount = 0;
  let expectedAtoms = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Line 6 or 7 has atom counts
    if (i === 5 || i === 6) {
      const tokens = line.split(/\s+/);
      if (tokens.every(t => /^\d+$/.test(t))) {
        expectedAtoms = tokens.reduce((sum, t) => sum + parseInt(t), 0);
      }
    }

    // After coordinate mode line, count atom lines
    if (i >= 7 && !atomsStarted && /^[dDcCkK]/.test(line)) {
      atomsStarted = true;
      continue;
    }

    if (atomsStarted && atomCount < expectedAtoms) {
      atomCount++;
      if (atomCount === expectedAtoms) {
        poscarEnd = i + 1;
        break;
      }
    }
  }

  if (poscarEnd < 0) poscarEnd = 8;

  // Parse POSCAR part
  const poscarContent = lines.slice(0, poscarEnd).join('\n');
  const structure = parsePoscar(poscarContent);

  // Parse volumetric data
  // Skip blank lines after POSCAR
  let gridLine = poscarEnd;
  while (gridLine < lines.length && lines[gridLine].trim() === '') gridLine++;

  const gridTokens = lines[gridLine].trim().split(/\s+/).map(Number);
  const nx = gridTokens[0];
  const ny = gridTokens[1];
  const nz = gridTokens[2];
  gridLine++;

  // Read ALL grid blocks. CHGCAR writes with ix fastest (Fortran order);
  // store in C order (iz fastest) so `data[ix*ny*nz + iy*nz + iz]` works.
  // v0.23.3: after the first (charge) grid, VASP interleaves PAW
  // `augmentation occupancies` sections; the next density block starts at a
  // repeated `nx ny nz` dims line. Collect [charge], [charge,mag], or
  // [charge,mag_x,mag_y,mag_z] and classify below.
  const totalPoints = nx * ny * nz;
  const rawGrids: Float32Array[] = [];
  let i = gridLine;

  while (rawGrids.length === 0 || i < lines.length) {
    const data = new Float32Array(totalPoints);
    let ix = 0, iy = 0, iz = 0, count = 0;
    for (; i < lines.length && count < totalPoints; i++) {
      const line = lines[i].trim();
      if (line === '' || line.startsWith('augmentation')) break;
      const tokens = line.split(/\s+/);
      for (const t of tokens) {
        if (count < totalPoints && t !== '') {
          data[ix * ny * nz + iy * nz + iz] = parseFloat(t);
          count++;
          ix++;
          if (ix === nx) { ix = 0; iy++; if (iy === ny) { iy = 0; iz++; } }
        }
      }
    }
    if (count < totalPoints) break;  // incomplete trailing block — stop
    rawGrids.push(data);
    // Seek the next density block's dims line (skipping augmentation/PAW).
    let next = -1;
    for (let j = i; j < lines.length; j++) {
      if (isDimsLine(lines[j].trim(), nx, ny, nz)) { next = j; break; }
    }
    if (next < 0) break;
    i = next + 1;  // data starts after the repeated dims line
  }

  const scale = 1 / cellVolume(structure.lattice);
  const volumetrics = buildChgcarGrids(rawGrids, structure.lattice, [nx, ny, nz], scale);

  return { structure, volumetric: volumetrics[0], volumetrics };
}

/**
 * Locate the POSCAR header end (line index, 0-based) given decoded lines
 * from the start of a CHGCAR. Mirrors the boundary-search logic in
 * `parseChgcar` so the byte and string paths agree on where the
 * structure ends and the charge grid begins.
 */
export function findPoscarEnd(lines: string[]): number {
  let poscarEnd = -1;
  let atomsStarted = false;
  let atomCount = 0;
  let expectedAtoms = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (i === 5 || i === 6) {
      const tokens = line.split(/\s+/);
      if (tokens.every(t => /^\d+$/.test(t))) {
        expectedAtoms = tokens.reduce((sum, t) => sum + parseInt(t), 0);
      }
    }
    if (i >= 7 && !atomsStarted && /^[dDcCkK]/.test(line)) {
      atomsStarted = true;
      continue;
    }
    if (atomsStarted && atomCount < expectedAtoms) {
      atomCount++;
      if (atomCount === expectedAtoms) {
        poscarEnd = i + 1;
        break;
      }
    }
  }
  return poscarEnd < 0 ? 8 : poscarEnd;
}

/**
 * Byte-path CHGCAR parser (v0.22 Tier 2). Reads the POSCAR header from a
 * small decoded prefix (≤ 256 KB covers any plausible atom count), then
 * iterates the charge-density grid line-by-line over the byte buffer.
 */
export function parseChgcarFromBytes(
  bytes: Uint8Array,
  options?: VolumetricLoadOptions,
): { structure: CrystalStructure; volumetric?: VolumetricData; volumetrics?: VolumetricData[] } {
  const PEEK = Math.min(bytes.length, 256 * 1024);
  const peekStr = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, PEEK));
  const peekLines = peekStr.split('\n');

  const poscarEnd = findPoscarEnd(peekLines);
  const poscarContent = peekLines.slice(0, poscarEnd).join('\n');
  const structure = parsePoscar(poscarContent);

  // Walk past blank lines after POSCAR to find the grid-dims line.
  let gridLineIdx = poscarEnd;
  while (gridLineIdx < peekLines.length && peekLines[gridLineIdx].trim() === '') gridLineIdx++;
  if (gridLineIdx >= peekLines.length) {
    throw new Error('parseChgcarFromBytes: grid-dims line not within peek window');
  }
  const gridTokens = peekLines[gridLineIdx].trim().split(/\s+/).map(Number);
  const nx = gridTokens[0], ny = gridTokens[1], nz = gridTokens[2];

  // Compute byte offset where charge values begin (the line after grid-dims).
  const dataStartByte = offsetAfterLines(bytes, gridLineIdx + 1);
  if (dataStartByte < 0) {
    throw new Error('parseChgcarFromBytes: grid data starts beyond buffer');
  }

  const totalPoints = nx * ny * nz;
  const cap = options?.maxGridPoints ?? VOLUMETRIC_SAFETY_MAX_GRID_POINTS;
  const stride = chooseStride(nx, ny, nz, cap);
  const outNx = Math.ceil(nx / stride);
  const outNy = Math.ceil(ny / stride);
  const outNz = Math.ceil(nz / stride);
  // v0.23.3: stream ALL grid blocks (charge + magnetization/σ), skipping the
  // PAW augmentation sections between them; each new block begins at a
  // repeated `nx ny nz` dims line. Stride applied per grid during ingestion.
  // v0.23.1: factor > 1 → trilinear resampler (periodic; CHGCAR grids are
  // periodic with no duplicated endpoint). Factor 1 writes straight through.
  const rawGrids: Float32Array[] = [];
  const newAcc = () => (stride > 1
    ? new GridResampler([nx, ny, nz], [outNx, outNy, outNz], { order: 'x-fastest' })
    : null);
  let acc = newAcc();
  let data: Float32Array | null = acc ? null : new Float32Array(totalPoints);
  let ix = 0, iy = 0, iz = 0, count = 0;
  let reading = true;  // true = accumulating a grid; false = seeking next dims line

  const bank = () => { rawGrids.push(acc ? acc.finish() : data!); };
  const startNewGrid = () => {
    acc = newAcc();
    data = acc ? null : new Float32Array(totalPoints);
    ix = iy = iz = count = 0;
    reading = true;
  };

  for (const rawLine of iterLines(bytes.subarray(dataStartByte))) {
    const line = rawLine.trim();
    if (!reading) {
      if (isDimsLine(line, nx, ny, nz)) startNewGrid();
      continue;
    }
    if (count >= totalPoints) {
      // Current grid full: bank it, then seek the next block. The finishing
      // line is usually `augmentation …`; if it's already the next dims line
      // (no augmentation), start the next grid immediately.
      bank();
      reading = false;
      if (isDimsLine(line, nx, ny, nz)) startNewGrid();
      continue;
    }
    if (line === '' || line.startsWith('augmentation')) {
      // Separator before the grid was full → malformed block; drop partial.
      reading = false;
      continue;
    }
    const tokens = line.split(/\s+/);
    for (const t of tokens) {
      if (count >= totalPoints || t === '') continue;
      // CHGCAR source ordering matches XSF (Fortran ix-fastest in stream).
      if (acc) acc.push(parseFloat(t));
      else data![ix * ny * nz + iy * nz + iz] = parseFloat(t);
      count++;
      ix++;
      if (ix === nx) { ix = 0; iy++; if (iy === ny) { iy = 0; iz++; } }
    }
  }
  // Bank a trailing grid that completed on the final line (no separator after).
  if (reading && count >= totalPoints) bank();

  const scale = 1 / cellVolume(structure.lattice);
  const volumetrics = buildChgcarGrids(
    rawGrids, structure.lattice, [outNx, outNy, outNz], scale, stride, [nx, ny, nz],
  );

  return { structure, volumetric: volumetrics[0], volumetrics };
}
