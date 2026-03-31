import { CrystalStructure } from './types';

export function parsePoscar(content: string): CrystalStructure {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const title = lines[0] || '';
  const scale = parseFloat(lines[1]);

  // Lattice vectors (lines 2-4)
  const lattice: [number, number, number][] = [];
  for (let i = 2; i <= 4; i++) {
    const vals = lines[i].split(/\s+/).map(Number);
    lattice.push([vals[0] * scale, vals[1] * scale, vals[2] * scale]);
  }

  // Species names and counts
  // VASP 5+: line 5 is species names, line 6 is counts
  // VASP 4: line 5 is counts directly (all digits)
  let speciesNames: string[];
  let counts: number[];
  let posStart: number;

  const line5tokens = lines[5].split(/\s+/);
  if (line5tokens.every(t => /^\d+$/.test(t))) {
    // VASP 4 format - no species names
    // Try to extract from title
    speciesNames = title.split(/\s+/).filter(t => /^[A-Z][a-z]?$/.test(t));
    counts = line5tokens.map(Number);
    posStart = 6;
  } else {
    speciesNames = line5tokens;
    counts = lines[6].split(/\s+/).map(Number);
    posStart = 7;
  }

  // Check for "Selective dynamics" line
  if (lines[posStart] && /^[sS]/.test(lines[posStart])) {
    posStart++;
  }

  // Coordinate mode
  const mode = lines[posStart];
  const isDirect = /^[dD]/.test(mode);
  posStart++;

  // Read positions
  const species: string[] = [];
  const positions: [number, number, number][] = [];

  let atomIdx = 0;
  for (let si = 0; si < speciesNames.length; si++) {
    for (let ci = 0; ci < counts[si]; ci++) {
      const vals = lines[posStart + atomIdx].split(/\s+/).map(Number);
      species.push(speciesNames[si]);

      if (isDirect) {
        // Convert fractional to cartesian
        const [fx, fy, fz] = vals;
        const x = fx * lattice[0][0] + fy * lattice[1][0] + fz * lattice[2][0];
        const y = fx * lattice[0][1] + fy * lattice[1][1] + fz * lattice[2][1];
        const z = fx * lattice[0][2] + fy * lattice[1][2] + fz * lattice[2][2];
        positions.push([x, y, z]);
      } else {
        positions.push([vals[0] * scale, vals[1] * scale, vals[2] * scale]);
      }
      atomIdx++;
    }
  }

  return { lattice, species, positions, pbc: [true, true, true], title };
}
