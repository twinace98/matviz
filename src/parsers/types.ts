export interface CrystalStructure {
  lattice: [number, number, number][];  // 3 lattice vectors in Angstroms
  species: string[];                     // element symbol per atom
  positions: [number, number, number][]; // cartesian positions in Angstroms
  pbc: [boolean, boolean, boolean];
  title?: string;
  spaceGroup?: string;
  cellParams?: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };
  symmetryOps?: string[];  // e.g., ["x,y,z", "-x+1/2,y,-z+1/2"]

  // v0.16 optional extensions — populated by parsers when source data carries
  // these properties. Renderer/UI must guard with `?.[i]` since these arrays
  // are absent (undefined) for parsers/files that don't supply them. When
  // present, length must equal species.length (parser-enforced invariant).
  //
  // 16.1 thermal ellipsoids: Anisotropic displacement parameters Uᵢⱼ in Å².
  //   `null` entry means "no aniso data for this atom" — use isotropic sphere
  //   for that site even when other atoms have ellipsoids.
  thermalAniso?: Array<{ U11: number; U22: number; U33: number; U12: number; U13: number; U23: number } | null>;
  // 16.2 partial occupancy: 0..1 per atom. Atoms with occupancy < 1.0 may
  //   share coordinates with other species (mixed sites). Default behavior
  //   (showPartialOccupancy=false) renders only the dominant species per site.
  occupancy?: number[];
  // 16.3 magnetic moment vectors: per-atom Cartesian moment vector in μB.
  //   [0,0,0] means no moment.
  magMom?: Array<[number, number, number]>;
}

export interface VolumetricData {
  origin: [number, number, number];
  lattice: [number, number, number][];
  dims: [number, number, number];
  data: Float32Array;
}
