import { CrystalStructure } from './types';

/**
 * Minimal CIF parser. Handles basic CIF files with explicit atom positions.
 * Supports _cell_length/angle, _atom_site_fract/Cartn, and symmetry-expanded sites.
 */
export function parseCif(content: string): CrystalStructure {
  const lines = content.split('\n');

  // Parse cell parameters
  let a = 0, b = 0, c = 0, alpha = 90, beta = 90, gamma = 90;
  let title = '';

  const loopColumns: string[] = [];
  const loopRows: string[][] = [];
  let inLoop = false;
  let inAtomLoop = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('data_')) {
      title = line.slice(5);
      continue;
    }

    // Single-value cell parameters
    if (line.startsWith('_cell_length_a')) { a = parseCifFloat(line); continue; }
    if (line.startsWith('_cell_length_b')) { b = parseCifFloat(line); continue; }
    if (line.startsWith('_cell_length_c')) { c = parseCifFloat(line); continue; }
    if (line.startsWith('_cell_angle_alpha')) { alpha = parseCifFloat(line); continue; }
    if (line.startsWith('_cell_angle_beta')) { beta = parseCifFloat(line); continue; }
    if (line.startsWith('_cell_angle_gamma')) { gamma = parseCifFloat(line); continue; }

    // Loop parsing
    if (line === 'loop_') {
      if (inAtomLoop && loopRows.length > 0) break; // done with atom loop
      inLoop = true;
      inAtomLoop = false;
      loopColumns.length = 0;
      loopRows.length = 0;
      continue;
    }

    if (inLoop && line.startsWith('_')) {
      loopColumns.push(line.split(/\s+/)[0]);
      if (line.includes('_atom_site_')) {
        inAtomLoop = true;
      }
      continue;
    }

    if (inLoop && !line.startsWith('_') && line.length > 0 && !line.startsWith('#')) {
      if (inAtomLoop) {
        const tokens = tokenizeCifLine(line);
        if (tokens.length >= loopColumns.length) {
          loopRows.push(tokens);
        } else {
          // End of this loop
          inLoop = false;
          if (inAtomLoop && loopRows.length > 0) break;
        }
      } else {
        // Not an atom loop, skip data rows
        if (line === '' || line.startsWith('loop_') || line.startsWith('_')) {
          inLoop = false;
        }
      }
      continue;
    }

    if (inLoop && (line === '' || line.startsWith('#'))) {
      inLoop = false;
      if (inAtomLoop && loopRows.length > 0) break;
    }
  }

  // Build lattice from cell parameters
  const lattice = cellToLattice(a, b, c, alpha, beta, gamma);

  // Extract atom positions from loop
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

  const species: string[] = [];
  const positions: [number, number, number][] = [];

  for (const row of loopRows) {
    // Get element symbol
    let symbol = '';
    if (typeCol >= 0 && row[typeCol]) {
      symbol = row[typeCol].replace(/[^a-zA-Z]/g, '');
    } else if (labelCol >= 0 && row[labelCol]) {
      symbol = row[labelCol].replace(/[0-9+\-]/g, '');
    }
    if (!symbol) continue;

    // Normalize: first letter uppercase, rest lowercase
    symbol = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
    species.push(symbol);

    if (hasFractional) {
      const fx = parseCifNumber(row[fracXCol]);
      const fy = parseCifNumber(row[fracYCol]);
      const fz = parseCifNumber(row[fracZCol]);
      // Convert fractional to cartesian
      const x = fx * lattice[0][0] + fy * lattice[1][0] + fz * lattice[2][0];
      const y = fx * lattice[0][1] + fy * lattice[1][1] + fz * lattice[2][1];
      const z = fx * lattice[0][2] + fy * lattice[1][2] + fz * lattice[2][2];
      positions.push([x, y, z]);
    } else if (hasCartesian) {
      positions.push([
        parseCifNumber(row[cartXCol]),
        parseCifNumber(row[cartYCol]),
        parseCifNumber(row[cartZCol]),
      ]);
    }
  }

  return {
    lattice,
    species,
    positions,
    pbc: [true, true, true],
    title,
  };
}

function parseCifFloat(line: string): number {
  const parts = line.trim().split(/\s+/);
  return parseCifNumber(parts[parts.length - 1]);
}

function parseCifNumber(s: string): number {
  // Remove uncertainty in parentheses, e.g., "1.234(5)" -> "1.234"
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
      i++; // skip closing quote
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
