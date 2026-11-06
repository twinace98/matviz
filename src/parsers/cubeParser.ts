import {
  CrystalStructure, VolumetricData,
  VolumetricLoadOptions, VOLUMETRIC_SAFETY_MAX_GRID_POINTS, chooseStride,
} from './types';
import { getElementByNumber } from '../shared/elements-data';
import { iterLines, offsetAfterLines } from './lineIterator';
import { GridResampler } from './downsample';

const BOHR_TO_ANG = 0.529177249;

interface CubeHeader {
  structure: CrystalStructure;
  origin: [number, number, number];
  lattice: [number, number, number][];
  dims: [number, number, number];
  nAtoms: number;
}

function parseCubeHeader(lines: string[]): CubeHeader {
  const title = lines[0].trim();

  const line2 = lines[2].trim().split(/\s+/).map(Number);
  const nAtoms = Math.abs(Math.round(line2[0]));
  const origin: [number, number, number] = [
    line2[1] * BOHR_TO_ANG,
    line2[2] * BOHR_TO_ANG,
    line2[3] * BOHR_TO_ANG,
  ];

  const dims: [number, number, number] = [0, 0, 0];
  const voxelVecs: [number, number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const tokens = lines[3 + i].trim().split(/\s+/).map(Number);
    dims[i] = Math.abs(Math.round(tokens[0]));
    const scale = line2[0] >= 0 ? BOHR_TO_ANG : 1;
    voxelVecs.push([
      tokens[1] * scale * dims[i],
      tokens[2] * scale * dims[i],
      tokens[3] * scale * dims[i],
    ]);
  }
  const lattice: [number, number, number][] = voxelVecs;

  const species: string[] = [];
  const positions: [number, number, number][] = [];
  const atomScale = line2[0] >= 0 ? BOHR_TO_ANG : 1;
  for (let i = 0; i < nAtoms; i++) {
    const tokens = lines[6 + i].trim().split(/\s+/).map(Number);
    const atomicNum = Math.round(tokens[0]);
    const el = getElementByNumber(atomicNum);
    species.push(el.symbol);
    positions.push([
      tokens[2] * atomScale,
      tokens[3] * atomScale,
      tokens[4] * atomScale,
    ]);
  }

  return {
    structure: { lattice, species, positions, pbc: [true, true, true], title },
    origin,
    lattice,
    dims,
    nAtoms,
  };
}

export function parseCube(content: string): { structure: CrystalStructure; volumetric: VolumetricData } {
  const lines = content.split('\n');
  const header = parseCubeHeader(lines);

  const totalPoints = header.dims[0] * header.dims[1] * header.dims[2];
  const data = new Float32Array(totalPoints);
  const dataStart = 6 + header.nAtoms;
  let idx = 0;
  for (let i = dataStart; i < lines.length && idx < totalPoints; i++) {
    const tokens = lines[i].trim().split(/\s+/);
    for (const t of tokens) {
      if (idx < totalPoints && t !== '') {
        data[idx++] = parseFloat(t);
      }
    }
  }

  return {
    structure: header.structure,
    volumetric: { origin: header.origin, lattice: header.lattice, dims: header.dims, data },
  };
}

/**
 * Byte-path Gaussian Cube parser (v0.22 Tier 2). Decodes only the header
 * (first `6 + nAtoms` lines, always well under a few KB) as a string for
 * reuse with the existing header parser; iterates the grid blob
 * line-by-line over the remaining byte buffer. No intermediate full-size
 * Float32Array allocation.
 */
export function parseCubeFromBytes(
  bytes: Uint8Array,
  options?: VolumetricLoadOptions,
): { structure: CrystalStructure; volumetric: VolumetricData } {
  // Peek a few KB to read line 2's atom count, then compute the precise
  // header byte offset.
  const PEEK = Math.min(bytes.length, 64 * 1024);
  const peekStr = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, PEEK));
  const peekLines = peekStr.split('\n');
  const line2 = peekLines[2].trim().split(/\s+/).map(Number);
  const nAtoms = Math.abs(Math.round(line2[0]));

  const headerLineCount = 6 + nAtoms;
  const dataStartByte = offsetAfterLines(bytes, headerLineCount);

  // Decode just the header lines (always small).
  const headerEnd = dataStartByte >= 0 ? dataStartByte : bytes.length;
  const headerStr = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, headerEnd));
  const header = parseCubeHeader(headerStr.split('\n'));

  const [nx, ny, nz] = header.dims;
  const totalPoints = nx * ny * nz;
  const cap = options?.maxGridPoints ?? VOLUMETRIC_SAFETY_MAX_GRID_POINTS;
  const stride = chooseStride(nx, ny, nz, cap);
  const outNx = Math.ceil(nx / stride);
  const outNy = Math.ceil(ny / stride);
  const outNz = Math.ceil(nz / stride);
  // Cube source ordering: ix slowest, iz fastest — identical to the C-order
  // memory layout, so factor 1 writes straight through. Factor > 1 feeds the
  // v0.23.1 trilinear resampler (periodic, no position drift).
  const acc = stride > 1
    ? new GridResampler([nx, ny, nz], [outNx, outNy, outNz], { order: 'z-fastest' })
    : null;
  let data: Float32Array | null = acc ? null : new Float32Array(totalPoints);
  let count = 0;

  if (dataStartByte >= 0) {
    for (const rawLine of iterLines(bytes.subarray(dataStartByte))) {
      if (count >= totalPoints) break;
      const tokens = rawLine.trim().split(/\s+/);
      for (const t of tokens) {
        if (count >= totalPoints || t === '') continue;
        if (acc) acc.push(parseFloat(t));
        else data![count] = parseFloat(t);
        count++;
      }
    }
  }

  if (acc) data = acc.finish();
  const volumetric: VolumetricData = {
    origin: header.origin,
    lattice: header.lattice,
    dims: [outNx, outNy, outNz],
    data: data!,
  };
  if (stride > 1) {
    volumetric.stride = stride;
    volumetric.originalDims = [nx, ny, nz];
  }

  return { structure: header.structure, volumetric };
}
