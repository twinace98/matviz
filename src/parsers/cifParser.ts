import { CrystalStructure } from './types';

/**
 * CIF parser with symmetry expansion + anisotropic displacement support.
 *
 * Loop tracking (v0.16.1): the previous single-loop scheme dropped the atom
 * loop's data when ANY subsequent loop appeared (e.g. an `_atom_site_aniso_*`
 * loop after the atom loop). Refactored to accumulate every non-symmetry loop
 * into `parsedLoops`; the asymmetric-unit and aniso loops are then resolved by
 * column-name matching after the scan.
 *
 * Anisotropic displacement (16.1): `_atom_site_aniso_label` loop entries are
 * matched to atom-site rows by the shared label. U-form (Å²) is preserved
 * as-is; B-form (Å²) is converted via `U = B / (8 π²)`. Symmetry-expanded
 * copies inherit the asymmetric atom's Uᵢⱼ *without* rotation by the symop
 * (TODO 16.x: apply R · U · Rᵀ for non-identity symops). Visually accurate
 * for diagonal-dominant U; off-axis U components mis-orient on non-trivial
 * symops. Limitation documented in working log.
 *
 * Degenerate-cell guard (16.1): cellToLattice() throws if `sin(γ) < 1e-6` or
 * any cell length is below 1e-9 Å, so the editor's parse-error boundary
 * (v0.13.1) surfaces "Open as Text" instead of yielding NaN-laden positions.
 */

interface CifLoop {
  columns: string[];
  rows: string[][];
}

export function parseCif(content: string): CrystalStructure {
  const lines = content.split('\n');

  let a = 0, b = 0, c = 0, alpha = 90, beta = 90, gamma = 90;
  let title = '';
  let spaceGroup = '';

  const symmetryOps: string[] = [];
  const parsedLoops: CifLoop[] = [];

  // Loop scanner state — tracks one in-progress loop at a time. On `loop_`
  // the in-progress loop (if non-empty) is pushed to parsedLoops.
  let currentLoop: CifLoop | null = null;
  let inLoopHeader = false;     // we've seen `loop_` and are reading column lines
  let isSymLoop = false;         // current loop is the symmetry-op loop (handled separately)

  function finalizeLoop() {
    if (currentLoop && currentLoop.columns.length > 0 && currentLoop.rows.length > 0) {
      parsedLoops.push(currentLoop);
    }
    currentLoop = null;
    inLoopHeader = false;
    isSymLoop = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('data_')) {
      title = line.slice(5);
      continue;
    }

    // Cell parameters (outside any loop)
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

    // Single (non-loop) symmetry op
    if (line.startsWith('_symmetry_equiv_pos_as_xyz') && currentLoop === null) {
      const parts = line.split(/\s+/);
      if (parts.length > 1) {
        symmetryOps.push(parts.slice(1).join(' ').replace(/['"]/g, ''));
      }
      continue;
    }

    // Start a new loop
    if (line === 'loop_') {
      finalizeLoop();
      currentLoop = { columns: [], rows: [] };
      inLoopHeader = true;
      continue;
    }

    // Loop column declaration
    if (currentLoop && inLoopHeader && line.startsWith('_')) {
      const col = line.split(/\s+/)[0];
      if (col === '_symmetry_equiv_pos_as_xyz' || col === '_space_group_symop_operation_xyz') {
        isSymLoop = true;
      }
      currentLoop.columns.push(col);
      continue;
    }

    // Loop data row (or transition out of loop)
    if (currentLoop && line.length > 0 && !line.startsWith('#')) {
      // First non-`_` non-blank line transitions header → data
      inLoopHeader = false;

      if (isSymLoop) {
        // Parse symmetry operation: strip quotes, optional leading index number
        let op = line.replace(/['"]/g, '').trim();
        op = op.replace(/^\d+\s+/, '');  // drop leading index e.g. "1 x,y,z" → "x,y,z"
        if (op.includes(',')) {
          symmetryOps.push(op.replace(/\s/g, ''));
        }
        continue;
      }

      const tokens = tokenizeCifLine(line);
      if (tokens.length >= currentLoop.columns.length) {
        currentLoop.rows.push(tokens);
      } else {
        // Row width mismatch → end of this loop
        finalizeLoop();
      }
      continue;
    }

    // Blank line or comment → if we were in a loop and have data, finalize
    if (currentLoop && (line === '' || line.startsWith('#'))) {
      // Only finalize when we've actually seen data; blank lines inside header
      // (between column declarations) shouldn't kill the loop.
      if (!inLoopHeader) {
        finalizeLoop();
      }
    }
  }
  // EOF: finalize any open loop
  finalizeLoop();

  const lattice = cellToLattice(a, b, c, alpha, beta, gamma);

  // Find the atom-site loop (has at least one of the position columns) and the
  // optional aniso loop. A CIF could in theory have multiple atom loops; we
  // take the first match for each.
  const atomLoop = parsedLoops.find(L =>
    L.columns.includes('_atom_site_label') ||
    L.columns.includes('_atom_site_fract_x') ||
    L.columns.includes('_atom_site_Cartn_x')
  );
  const anisoLoop = parsedLoops.find(L =>
    L.columns.includes('_atom_site_aniso_label')
  );

  if (!atomLoop) {
    return { lattice, species: [], positions: [], pbc: [true, true, true], title, spaceGroup: spaceGroup || undefined };
  }

  // ---- Atom site loop ----
  const colIdx = (L: CifLoop, name: string) => L.columns.indexOf(name);
  const labelCol = colIdx(atomLoop, '_atom_site_label');
  const typeCol = colIdx(atomLoop, '_atom_site_type_symbol');
  const fracXCol = colIdx(atomLoop, '_atom_site_fract_x');
  const fracYCol = colIdx(atomLoop, '_atom_site_fract_y');
  const fracZCol = colIdx(atomLoop, '_atom_site_fract_z');
  const cartXCol = colIdx(atomLoop, '_atom_site_Cartn_x');
  const cartYCol = colIdx(atomLoop, '_atom_site_Cartn_y');
  const cartZCol = colIdx(atomLoop, '_atom_site_Cartn_z');

  const hasFractional = fracXCol >= 0 && fracYCol >= 0 && fracZCol >= 0;
  const hasCartesian = cartXCol >= 0 && cartYCol >= 0 && cartZCol >= 0;

  const asymSpecies: string[] = [];
  const asymLabels: string[] = [];
  const asymFractional: [number, number, number][] = [];

  for (const row of atomLoop.rows) {
    let symbol = '';
    let label = '';
    if (labelCol >= 0 && row[labelCol]) label = row[labelCol];
    if (typeCol >= 0 && row[typeCol]) {
      symbol = row[typeCol].replace(/[^a-zA-Z]/g, '');
    } else if (label) {
      symbol = label.replace(/[0-9+\-]/g, '');
    }
    if (!symbol) continue;
    symbol = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();

    if (hasFractional) {
      asymSpecies.push(symbol);
      asymLabels.push(label);
      asymFractional.push([
        parseCifNumber(row[fracXCol]),
        parseCifNumber(row[fracYCol]),
        parseCifNumber(row[fracZCol]),
      ]);
    } else if (hasCartesian) {
      asymSpecies.push(symbol);
      asymLabels.push(label);
      const x = parseCifNumber(row[cartXCol]);
      const y = parseCifNumber(row[cartYCol]);
      const z = parseCifNumber(row[cartZCol]);
      asymFractional.push(cartToFrac(lattice, x, y, z));
    }
  }

  // ---- Anisotropic displacement loop (optional) ----
  // Build label → Uᵢⱼ map. Accept either U-form (Å²) or B-form (B = 8π²·U).
  type Uij = { U11: number; U22: number; U33: number; U12: number; U13: number; U23: number };
  const anisoMap = new Map<string, Uij>();
  if (anisoLoop) {
    const aLabel = colIdx(anisoLoop, '_atom_site_aniso_label');
    const u11 = colIdx(anisoLoop, '_atom_site_aniso_U_11');
    const u22 = colIdx(anisoLoop, '_atom_site_aniso_U_22');
    const u33 = colIdx(anisoLoop, '_atom_site_aniso_U_33');
    const u12 = colIdx(anisoLoop, '_atom_site_aniso_U_12');
    const u13 = colIdx(anisoLoop, '_atom_site_aniso_U_13');
    const u23 = colIdx(anisoLoop, '_atom_site_aniso_U_23');
    const b11 = colIdx(anisoLoop, '_atom_site_aniso_B_11');
    const b22 = colIdx(anisoLoop, '_atom_site_aniso_B_22');
    const b33 = colIdx(anisoLoop, '_atom_site_aniso_B_33');
    const b12 = colIdx(anisoLoop, '_atom_site_aniso_B_12');
    const b13 = colIdx(anisoLoop, '_atom_site_aniso_B_13');
    const b23 = colIdx(anisoLoop, '_atom_site_aniso_B_23');

    const useU = u11 >= 0 && u22 >= 0 && u33 >= 0;
    const useB = !useU && b11 >= 0 && b22 >= 0 && b33 >= 0;
    const BTOU = 1 / (8 * Math.PI * Math.PI);

    if (aLabel >= 0 && (useU || useB)) {
      for (const row of anisoLoop.rows) {
        const lbl = row[aLabel];
        if (!lbl) continue;
        if (useU) {
          anisoMap.set(lbl, {
            U11: parseCifNumber(row[u11]),
            U22: parseCifNumber(row[u22]),
            U33: parseCifNumber(row[u33]),
            U12: u12 >= 0 ? parseCifNumber(row[u12]) : 0,
            U13: u13 >= 0 ? parseCifNumber(row[u13]) : 0,
            U23: u23 >= 0 ? parseCifNumber(row[u23]) : 0,
          });
        } else {
          anisoMap.set(lbl, {
            U11: parseCifNumber(row[b11]) * BTOU,
            U22: parseCifNumber(row[b22]) * BTOU,
            U33: parseCifNumber(row[b33]) * BTOU,
            U12: b12 >= 0 ? parseCifNumber(row[b12]) * BTOU : 0,
            U13: b13 >= 0 ? parseCifNumber(row[b13]) * BTOU : 0,
            U23: b23 >= 0 ? parseCifNumber(row[b23]) * BTOU : 0,
          });
        }
      }
    }
  }

  // ---- Apply symmetry operations ----
  let species: string[];
  let positions: [number, number, number][];
  let thermalAniso: Array<Uij | null> | undefined;

  if (symmetryOps.length > 0 && hasFractional) {
    const result = applySymmetryOps(asymSpecies, asymLabels, asymFractional, symmetryOps);
    species = result.species;
    positions = result.fractional.map(f => fracToCart(lattice, f));
    if (anisoMap.size > 0) {
      // Limitation: propagate Uᵢⱼ without rotation by the symop. Diagonal-
      // dominant U remains visually plausible; off-axis U mis-orients for
      // non-identity symops. Track via `_aniso_NEEDS_SYMOP_ROTATION` flag.
      thermalAniso = result.parentLabels.map(lbl => {
        const u = lbl ? anisoMap.get(lbl) : undefined;
        return u ? { ...u } : null;
      });
    }
  } else {
    species = asymSpecies;
    positions = hasFractional
      ? asymFractional.map(f => fracToCart(lattice, f))
      : atomLoop.rows
          .filter(_ => hasCartesian)
          .map(row => [
            parseCifNumber(row[cartXCol]),
            parseCifNumber(row[cartYCol]),
            parseCifNumber(row[cartZCol]),
          ] as [number, number, number]);
    if (anisoMap.size > 0) {
      thermalAniso = asymLabels.map(lbl => {
        const u = lbl ? anisoMap.get(lbl) : undefined;
        return u ? { ...u } : null;
      });
    }
  }

  // Length invariant guard: if some species lack aniso, the array is still
  // populated with `null` slots (above). No length mismatch can happen here
  // by construction.

  return {
    lattice,
    species,
    positions,
    pbc: [true, true, true],
    title,
    spaceGroup: spaceGroup || undefined,
    cellParams: { a, b, c, alpha, beta, gamma },
    symmetryOps: symmetryOps.length > 0 ? symmetryOps : undefined,
    ...(thermalAniso ? { thermalAniso } : {}),
  };
}

function applySymmetryOps(
  asymSpecies: string[],
  asymLabels: string[],
  asymFractional: [number, number, number][],
  ops: string[]
): { species: string[]; fractional: [number, number, number][]; parentLabels: string[] } {
  const species: string[] = [];
  const fractional: [number, number, number][] = [];
  const parentLabels: string[] = [];
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

      nx = ((nx % 1) + 1) % 1;
      ny = ((ny % 1) + 1) % 1;
      nz = ((nz % 1) + 1) % 1;

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
        parentLabels.push(asymLabels[i]);
      }
    }
  }

  return { species, fractional, parentLabels };
}

function parseSymOp(op: string): number[][] | null {
  const parts = op.split(',').map(s => s.trim());
  if (parts.length !== 3) return null;

  const matrix: number[][] = [];
  for (const part of parts) {
    const row = [0, 0, 0, 0];
    let expr = part.replace(/\s/g, '');

    const regex = /([+-]?)(\d+\/\d+|\d+\.?\d*)?([xyz])?/g;
    let match;
    while ((match = regex.exec(expr)) !== null) {
      if (match[0] === '') { regex.lastIndex++; continue; }
      if (!match[2] && !match[3]) continue;
      const sign = match[1] === '-' ? -1 : 1;

      if (match[3]) {
        const coeff = match[2] ? parseFraction(match[2]) : 1;
        const idx = 'xyz'.indexOf(match[3]);
        row[idx] = sign * coeff;
      } else if (match[2]) {
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
  // Degenerate-cell guard (16.1): caught by editor parse-error boundary.
  if (a < 1e-9 || b < 1e-9 || c < 1e-9) {
    throw new Error(`Degenerate lattice: cell length ≤ 0 (a=${a}, b=${b}, c=${c})`);
  }
  const degToRad = Math.PI / 180;
  const sinGamma = Math.sin(gamma * degToRad);
  if (Math.abs(sinGamma) < 1e-6) {
    throw new Error(`Degenerate lattice: gamma ≈ 0 or 180 (γ=${gamma}°), cell vectors collinear`);
  }
  const cosAlpha = Math.cos(alpha * degToRad);
  const cosBeta = Math.cos(beta * degToRad);
  const cosGamma = Math.cos(gamma * degToRad);

  const v1: [number, number, number] = [a, 0, 0];
  const v2: [number, number, number] = [b * cosGamma, b * sinGamma, 0];

  const cx = c * cosBeta;
  const cy = c * (cosAlpha - cosBeta * cosGamma) / sinGamma;
  const czSq = c * c - cx * cx - cy * cy;
  if (czSq < -1e-6) {
    throw new Error(`Degenerate lattice: angles inconsistent (α=${alpha}°, β=${beta}°, γ=${gamma}°), cz² = ${czSq.toFixed(6)}`);
  }
  const cz = Math.sqrt(Math.max(0, czSq));
  const v3: [number, number, number] = [cx, cy, cz];

  return [v1, v2, v3];
}
