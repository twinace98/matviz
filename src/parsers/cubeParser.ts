import { CrystalStructure, VolumetricData } from './types';
import { getElementByNumber } from '../shared/elements-data';

const BOHR_TO_ANG = 0.529177249;

export function parseCube(content: string): { structure: CrystalStructure; volumetric: VolumetricData } {
  const lines = content.split('\n');

  // Lines 0-1: comments
  const title = lines[0].trim();

  // Line 2: number of atoms, origin
  const line2 = lines[2].trim().split(/\s+/).map(Number);
  const nAtoms = Math.abs(Math.round(line2[0]));
  const origin: [number, number, number] = [
    line2[1] * BOHR_TO_ANG,
    line2[2] * BOHR_TO_ANG,
    line2[3] * BOHR_TO_ANG,
  ];

  // Lines 3-5: grid dimensions and vectors
  const dims: [number, number, number] = [0, 0, 0];
  const voxelVecs: [number, number, number][] = [];

  for (let i = 0; i < 3; i++) {
    const tokens = lines[3 + i].trim().split(/\s+/).map(Number);
    dims[i] = Math.abs(Math.round(tokens[0]));
    // If N is positive, units are Bohr; if negative, Angstroms
    const scale = line2[0] >= 0 ? BOHR_TO_ANG : 1;
    voxelVecs.push([
      tokens[1] * scale * dims[i],
      tokens[2] * scale * dims[i],
      tokens[3] * scale * dims[i],
    ]);
  }

  // Lattice = voxel vectors * dims (already multiplied above)
  const lattice: [number, number, number][] = voxelVecs;

  // Lines 6 to 6+nAtoms-1: atom data
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

  // Volumetric data starts after atoms
  const dataStart = 6 + nAtoms;
  const totalPoints = dims[0] * dims[1] * dims[2];
  const data = new Float32Array(totalPoints);
  let idx = 0;

  for (let i = dataStart; i < lines.length && idx < totalPoints; i++) {
    const tokens = lines[i].trim().split(/\s+/);
    for (const t of tokens) {
      if (idx < totalPoints && t !== '') {
        data[idx++] = parseFloat(t);
      }
    }
  }

  const structure: CrystalStructure = {
    lattice,
    species,
    positions,
    pbc: [true, true, true],
    title,
  };

  const volumetric: VolumetricData = {
    origin,
    lattice,
    dims,
    data,
  };

  return { structure, volumetric };
}
