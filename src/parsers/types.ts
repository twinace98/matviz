export interface CrystalStructure {
  lattice: [number, number, number][];  // 3 lattice vectors in Angstroms
  species: string[];                     // element symbol per atom
  positions: [number, number, number][]; // cartesian positions in Angstroms
  pbc: [boolean, boolean, boolean];
  title?: string;
}

export interface ElementData {
  symbol: string;
  number: number;
  color: string;       // hex color
  covalentRadius: number;  // Angstroms
  vdwRadius: number;       // Angstroms
}
