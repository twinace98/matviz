import { CrystalStructure } from './types';

const BOHR_TO_ANG = 0.529177249;

export function parseQE(content: string): CrystalStructure {
  const lines = content.split('\n');
  let lattice: [number, number, number][] = [];
  const species: string[] = [];
  const positions: [number, number, number][] = [];
  let title = 'QE output';

  // Try to parse final coordinates from pw.x output
  let i = 0;
  let celldm1 = 1.0;

  // Find CELL_PARAMETERS or celldm
  let lastCellIdx = -1;
  let lastPosIdx = -1;

  for (i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.includes('celldm(1)')) {
      const match = line.match(/celldm\(1\)\s*=\s*([0-9.eEdD+-]+)/);
      if (match) celldm1 = parseFloat(match[1]) * BOHR_TO_ANG;
    }

    if (line.startsWith('CELL_PARAMETERS')) {
      lastCellIdx = i;
    }

    if (line.startsWith('ATOMIC_POSITIONS')) {
      lastPosIdx = i;
    }
  }

  // Use the last occurrence (final relaxed structure)
  if (lastCellIdx >= 0) {
    const isBohr = lines[lastCellIdx].toLowerCase().includes('bohr');
    const isAlat = lines[lastCellIdx].toLowerCase().includes('alat');
    const scale = isBohr ? BOHR_TO_ANG : isAlat ? celldm1 : 1.0;

    lattice = [];
    for (let j = 1; j <= 3; j++) {
      const vals = lines[lastCellIdx + j].trim().split(/\s+/).map(Number);
      lattice.push([vals[0] * scale, vals[1] * scale, vals[2] * scale]);
    }
  }

  if (lastPosIdx >= 0) {
    const mode = lines[lastPosIdx].toLowerCase();
    const isCrystal = mode.includes('crystal');
    const isBohr = mode.includes('bohr');

    species.length = 0;
    positions.length = 0;

    for (let j = lastPosIdx + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (line === '' || line.startsWith('End') || line.startsWith('CELL') || line.startsWith('ATOMIC')) break;
      const tokens = line.split(/\s+/);
      if (tokens.length < 4) break;

      const symbol = tokens[0].charAt(0).toUpperCase() + tokens[0].slice(1).toLowerCase();
      species.push(symbol);

      const x = parseFloat(tokens[1]);
      const y = parseFloat(tokens[2]);
      const z = parseFloat(tokens[3]);

      if (isCrystal && lattice.length === 3) {
        positions.push([
          x * lattice[0][0] + y * lattice[1][0] + z * lattice[2][0],
          x * lattice[0][1] + y * lattice[1][1] + z * lattice[2][1],
          x * lattice[0][2] + y * lattice[1][2] + z * lattice[2][2],
        ]);
      } else if (isBohr) {
        positions.push([x * BOHR_TO_ANG, y * BOHR_TO_ANG, z * BOHR_TO_ANG]);
      } else {
        positions.push([x, y, z]);
      }
    }
  }

  if (lattice.length !== 3 || positions.length === 0) {
    throw new Error(
      'Quantum ESPRESSO parser found no CELL_PARAMETERS / ATOMIC_POSITIONS. ' +
      'File may not be a QE input/output, or the calculation did not produce final coordinates yet.'
    );
  }

  return { lattice, species, positions, pbc: [true, true, true], title };
}
