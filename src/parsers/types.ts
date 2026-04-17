export interface CrystalStructure {
  lattice: [number, number, number][];  // 3 lattice vectors in Angstroms
  species: string[];                     // element symbol per atom
  positions: [number, number, number][]; // cartesian positions in Angstroms
  pbc: [boolean, boolean, boolean];
  title?: string;
  spaceGroup?: string;
  cellParams?: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };
  symmetryOps?: string[];  // e.g., ["x,y,z", "-x+1/2,y,-z+1/2"]
}

export interface VolumetricData {
  origin: [number, number, number];
  lattice: [number, number, number][];
  dims: [number, number, number];
  data: Float32Array;
}
