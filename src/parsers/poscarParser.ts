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

  // 16.3: parse VASP MAGMOM if present in the title comment line. Convention:
  //   "MAGMOM = 2 -2 0 0"          (collinear, N tokens, → [0,0,m] per atom)
  //   "MAGMOM = 0 0 1.5 0 0 -1.5"  (non-collinear, 3N tokens, → [mx,my,mz])
  // Compressed form ("4*1.0 -2*1.5") not yet supported (16.x).
  // INCAR auto-discovery deferred to extension host (16.x).
  const magMom = parseMagmomFromTitle(title, species.length);
  const result: CrystalStructure = { lattice, species, positions, pbc: [true, true, true], title };
  if (magMom) result.magMom = magMom;
  return result;
}

/**
 * Extracts a VASP-style MAGMOM list from the POSCAR comment line.
 * Returns null when no MAGMOM tag is present, the token count doesn't
 * match either the collinear (N) or non-collinear (3N) convention, or
 * any token isn't a finite number. Compressed form (`k*v`) not supported.
 */
export function parseMagmomFromTitle(title: string, atomCount: number): Array<[number, number, number]> | null {
  // Match "MAGMOM = ..." or "MAGMOM=..."; capture rest of the line
  const m = title.match(/MAGMOM\s*=\s*(.*)$/i);
  if (!m) return null;
  const tokens = m[1].split(/[\s,]+/).filter(Boolean);
  if (tokens.some(t => t.includes('*'))) {
    // eslint-disable-next-line no-console
    console.warn('[magmom] compressed MAGMOM form (k*v) not supported, ignoring');
    return null;
  }
  const values = tokens.map(t => parseFloat(t));
  if (values.some(v => !Number.isFinite(v))) {
    // eslint-disable-next-line no-console
    console.warn('[magmom] MAGMOM contains non-numeric tokens, ignoring');
    return null;
  }
  const result: Array<[number, number, number]> = [];
  if (values.length === atomCount) {
    // Collinear: scalar per atom along z (LSORBIT=F default)
    for (const v of values) result.push([0, 0, v]);
    return result;
  }
  if (values.length === 3 * atomCount) {
    // Non-collinear: vector per atom (LSORBIT=T)
    for (let i = 0; i < atomCount; i++) {
      result.push([values[3 * i], values[3 * i + 1], values[3 * i + 2]]);
    }
    return result;
  }
  // eslint-disable-next-line no-console
  console.warn(`[magmom] MAGMOM token count ${values.length} matches neither N=${atomCount} (collinear) nor 3N=${3 * atomCount} (non-collinear), ignoring`);
  return null;
}
