import { CrystalStructure } from './types';

/**
 * CIF parser with symmetry expansion support.
 * Handles _cell_length/angle, _atom_site_fract/Cartn, _symmetry_equiv_pos_as_xyz.
 */
export function parseCif(content: string): CrystalStructure {
  const lines = content.split('\n');

  let a = 0, b = 0, c = 0, alpha = 90, beta = 90, gamma = 90;
  let title = '';
  let spaceGroup = '';

  const loopColumns: string[] = [];
  const loopRows: string[][] = [];
  let inLoop = false;
  let inAtomLoop = false;

  const symmetryOps: string[] = [];
  let inSymLoop = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('data_')) {
      title = line.slice(5);
      continue;
    }

    // Cell parameters
    if (line.startsWith('_cell_length_a')) { a = parseCifFloat(line); continue; }
    if (line.startsWith('_cell_length_b')) { b = parseCifFloat(line); continue; }
    if (line.startsWith('_cell_length_c')) { c = parseCifFloat(line); continue; }
    if (line.startsWith('_cell_angle_alpha')) { alpha = parseCifFloat(line); continue; }
    if (line.startsWith('_cell_angle_beta')) { beta = parseCifFloat(line); continue; }
    if (line.startsWith('_cell_angle_gamma')) { gamma = parseCifFloat(line); continue; }

    // Space group
    if (line.startsWith('_symmetry_space_group_name_H-M') || line.startsWith('_space_group_name_H-M')) {
      const parts = line.split(/\s+/);
      spaceGroup = parts.slice(1).join(' ').replace(/['"]/g, '');
      continue;
    }

    // Single symmetry op (non-loop)
    if (line.startsWith('_symmetry_equiv_pos_as_xyz') && !inLoop) {
      const parts = line.split(/\s+/);
      if (parts.length > 1) {
        symmetryOps.push(parts.slice(1).join(' ').replace(/['"]/g, ''));
      }
      continue;
    }

    // Loop parsing
    if (line === 'loop_') {
      if (inAtomLoop && loopRows.length > 0) {
        inLoop = false;
        inAtomLoop = false;
      }
      if (inSymLoop) {
        inSymLoop = false;
      }
      inLoop = true;
      if (!inAtomLoop || loopRows.length === 0) {
        loopColumns.length = 0;
        loopRows.length = 0;
        inAtomLoop = false;
      }
      continue;
    }

    if (inLoop && line.startsWith('_')) {
      const col = line.split(/\s+/)[0];
      if (col === '_symmetry_equiv_pos_as_xyz' || col === '_space_group_symop_operation_xyz') {
        inSymLoop = true;
      }
      if (col.includes('_atom_site_')) {
        inAtomLoop = true;
        loopColumns.push(col);
      } else if (inAtomLoop) {
        // Different loop starting while we were in atom loop
      } else if (!inSymLoop) {
        loopColumns.push(col);
      }
      continue;
    }

    if (inLoop && !line.startsWith('_') && line.length > 0 && !line.startsWith('#')) {
      if (inSymLoop) {
        // Parse symmetry operation: strip quotes, optional leading index number
        let op = line.replace(/['"]/g, '').trim();
        // Remove leading integer index (e.g. "1 x,y,z" → "x,y,z")
        op = op.replace(/^\d+\s+/, '');
        if (op.includes(',')) {
          // Remove all spaces so "x, y, z" → "x,y,z"
          symmetryOps.push(op.replace(/\s/g, ''));
        }
        continue;
      }

      if (inAtomLoop) {
        const tokens = tokenizeCifLine(line);
        if (tokens.length >= loopColumns.length) {
          loopRows.push(tokens);
        } else {
          inLoop = false;
        }
      }
      continue;
    }

    if (inLoop && (line === '' || line.startsWith('#'))) {
      if (inSymLoop) { inSymLoop = false; }
      inLoop = false;
    }
  }

  const lattice = cellToLattice(a, b, c, alpha, beta, gamma);

  const colIndex = (name: string) => loopColumns.indexOf(name);
  const labelCol = colIndex('_atom_site_label');
  const typeCol = colIndex('_atom_site_type_symbol');
  const fracXCol = colIndex('_atom_site_fract_x');
  const fracYCol = colIndex('_atom_site_fract_y');
  const fracZCol = colIndex('_atom_site_fract_z');
  const cartXCol = colIndex('_atom_site_Cartn_x');
  const cartYCol = colIndex('_atom_site_Cartn_y');
  const cartZCol = colIndex('_atom_site_Cartn_z');

  const hasFractional = fracXCol >= 0 && fracYCol >= 0 && fracZCol >= 0;
  const hasCartesian = cartXCol >= 0 && cartYCol >= 0 && cartZCol >= 0;

  // Parse asymmetric unit
  const asymSpecies: string[] = [];
  const asymFractional: [number, number, number][] = [];

  for (const row of loopRows) {
    let symbol = '';
    if (typeCol >= 0 && row[typeCol]) {
      symbol = row[typeCol].replace(/[^a-zA-Z]/g, '');
    } else if (labelCol >= 0 && row[labelCol]) {
      symbol = row[labelCol].replace(/[0-9+\-]/g, '');
    }
    if (!symbol) continue;
    symbol = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();

    if (hasFractional) {
      asymSpecies.push(symbol);
      asymFractional.push([
        parseCifNumber(row[fracXCol]),
        parseCifNumber(row[fracYCol]),
        parseCifNumber(row[fracZCol]),
      ]);
    } else if (hasCartesian) {
      asymSpecies.push(symbol);
      const x = parseCifNumber(row[cartXCol]);
      const y = parseCifNumber(row[cartYCol]);
      const z = parseCifNumber(row[cartZCol]);
      // Convert cartesian to fractional for symmetry expansion
      const frac = cartToFrac(lattice, x, y, z);
      asymFractional.push(frac);
    }
  }

  // Apply symmetry operations
  let species: string[];
  let positions: [number, number, number][];

  if (symmetryOps.length > 0 && hasFractional) {
    const result = applySymmetryOps(asymSpecies, asymFractional, symmetryOps);
    species = result.species;
    // Convert fractional to cartesian
    positions = result.fractional.map(f => fracToCart(lattice, f));
  } else {
    species = asymSpecies;
    if (hasFractional) {
      positions = asymFractional.map(f => fracToCart(lattice, f));
    } else {
      // Already cartesian from loopRows
      positions = [];
      for (const row of loopRows) {
        if (hasCartesian) {
          positions.push([
            parseCifNumber(row[cartXCol]),
            parseCifNumber(row[cartYCol]),
            parseCifNumber(row[cartZCol]),
          ]);
        }
      }
    }
  }

  return {
    lattice,
    species,
    positions,
    pbc: [true, true, true],
    title,
    spaceGroup: spaceGroup || undefined,
    cellParams: { a, b, c, alpha, beta, gamma },
    symmetryOps: symmetryOps.length > 0 ? symmetryOps : undefined,
  };
}

function applySymmetryOps(
  asymSpecies: string[],
  asymFractional: [number, number, number][],
  ops: string[]
): { species: string[]; fractional: [number, number, number][] } {
  const species: string[] = [];
  const fractional: [number, number, number][] = [];
  const seen = new Set<string>();
  const tol = 0.01;

  for (let i = 0; i < asymSpecies.length; i++) {
    const [fx, fy, fz] = asymFractional[i];

    for (const op of ops) {
      const matrix = parseSymOp(op);
      if (!matrix) continue;

      let nx = matrix[0][0] * fx + matrix[0][1] * fy + matrix[0][2] * fz + matrix[0][3];
      let ny = matrix[1][0] * fx + matrix[1][1] * fy + matrix[1][2] * fz + matrix[1][3];
      let nz = matrix[2][0] * fx + matrix[2][1] * fy + matrix[2][2] * fz + matrix[2][3];

      // Wrap to [0, 1)
      nx = ((nx % 1) + 1) % 1;
      ny = ((ny % 1) + 1) % 1;
      nz = ((nz % 1) + 1) % 1;

      // Check for duplicates
      const key = `${asymSpecies[i]}_${nx.toFixed(3)}_${ny.toFixed(3)}_${nz.toFixed(3)}`;
      let isDup = false;
      for (const existing of seen) {
        if (existing.startsWith(asymSpecies[i] + '_')) {
          const parts = existing.split('_');
          const ex = parseFloat(parts[1]);
          const ey = parseFloat(parts[2]);
          const ez = parseFloat(parts[3]);
          if (Math.abs(nx - ex) < tol && Math.abs(ny - ey) < tol && Math.abs(nz - ez) < tol) {
            isDup = true;
            break;
          }
        }
      }

      if (!isDup) {
        seen.add(key);
        species.push(asymSpecies[i]);
        fractional.push([nx, ny, nz]);
      }
    }
  }

  return { species, fractional };
}

function parseSymOp(op: string): number[][] | null {
  const parts = op.split(',').map(s => s.trim());
  if (parts.length !== 3) return null;

  const matrix: number[][] = [];
  for (const part of parts) {
    const row = [0, 0, 0, 0]; // coefficients for x, y, z, constant
    let expr = part.replace(/\s/g, '');

    // Match terms like +x, -y, +1/2, -1/4, x, y, z
    const regex = /([+-]?)(\d+\/\d+|\d+\.?\d*)?([xyz])?/g;
    let match;
    while ((match = regex.exec(expr)) !== null) {
      if (match[0] === '') { regex.lastIndex++; continue; }
      if (!match[2] && !match[3]) continue;
      const sign = match[1] === '-' ? -1 : 1;

      if (match[3]) {
        // Variable term (x, y, z)
        const coeff = match[2] ? parseFraction(match[2]) : 1;
        const idx = 'xyz'.indexOf(match[3]);
        row[idx] = sign * coeff;
      } else if (match[2]) {
        // Constant term
        row[3] += sign * parseFraction(match[2]);
      }
    }
    matrix.push(row);
  }
  return matrix;
}

function parseFraction(s: string): number {
  if (s.includes('/')) {
    const [num, den] = s.split('/').map(Number);
    return num / den;
  }
  return parseFloat(s);
}

function fracToCart(lattice: [number, number, number][], frac: [number, number, number]): [number, number, number] {
  return [
    frac[0] * lattice[0][0] + frac[1] * lattice[1][0] + frac[2] * lattice[2][0],
    frac[0] * lattice[0][1] + frac[1] * lattice[1][1] + frac[2] * lattice[2][1],
    frac[0] * lattice[0][2] + frac[1] * lattice[1][2] + frac[2] * lattice[2][2],
  ];
}

function cartToFrac(lattice: [number, number, number][], x: number, y: number, z: number): [number, number, number] {
  const a = lattice[0], b = lattice[1], c = lattice[2];
  const det = a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(det) < 1e-10) return [0, 0, 0];
  const invDet = 1 / det;
  // Transpose application: f_i = sum_j inv[j][i] * cart[j]
  return [
    ((b[1] * c[2] - b[2] * c[1]) * x + (b[2] * c[0] - b[0] * c[2]) * y + (b[0] * c[1] - b[1] * c[0]) * z) * invDet,
    ((a[2] * c[1] - a[1] * c[2]) * x + (a[0] * c[2] - a[2] * c[0]) * y + (a[1] * c[0] - a[0] * c[1]) * z) * invDet,
    ((a[1] * b[2] - a[2] * b[1]) * x + (a[2] * b[0] - a[0] * b[2]) * y + (a[0] * b[1] - a[1] * b[0]) * z) * invDet,
  ];
}

function parseCifFloat(line: string): number {
  const parts = line.trim().split(/\s+/);
  return parseCifNumber(parts[parts.length - 1]);
}

function parseCifNumber(s: string): number {
  return parseFloat(s.replace(/\([^)]*\)/g, ''));
}

function tokenizeCifLine(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === ' ' || line[i] === '\t') { i++; continue; }
    if (line[i] === "'" || line[i] === '"') {
      const quote = line[i];
      i++;
      const start = i;
      while (i < line.length && line[i] !== quote) i++;
      tokens.push(line.slice(start, i));
      i++;
    } else {
      const start = i;
      while (i < line.length && line[i] !== ' ' && line[i] !== '\t') i++;
      tokens.push(line.slice(start, i));
    }
  }
  return tokens;
}

function cellToLattice(
  a: number, b: number, c: number,
  alpha: number, beta: number, gamma: number
): [number, number, number][] {
  const degToRad = Math.PI / 180;
  const cosAlpha = Math.cos(alpha * degToRad);
  const cosBeta = Math.cos(beta * degToRad);
  const cosGamma = Math.cos(gamma * degToRad);
  const sinGamma = Math.sin(gamma * degToRad);

  const v1: [number, number, number] = [a, 0, 0];
  const v2: [number, number, number] = [b * cosGamma, b * sinGamma, 0];

  const cx = c * cosBeta;
  const cy = c * (cosAlpha - cosBeta * cosGamma) / sinGamma;
  const cz = Math.sqrt(c * c - cx * cx - cy * cy);
  const v3: [number, number, number] = [cx, cy, cz];

  return [v1, v2, v3];
}
