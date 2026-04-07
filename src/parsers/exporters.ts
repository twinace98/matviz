import { CrystalStructure } from './types';

export function exportCif(structure: CrystalStructure): string {
  const lines: string[] = [];
  lines.push(`data_exported`);
  lines.push('');

  const cp = structure.cellParams;
  if (cp) {
    lines.push(`_cell_length_a   ${cp.a.toFixed(6)}`);
    lines.push(`_cell_length_b   ${cp.b.toFixed(6)}`);
    lines.push(`_cell_length_c   ${cp.c.toFixed(6)}`);
    lines.push(`_cell_angle_alpha ${cp.alpha.toFixed(3)}`);
    lines.push(`_cell_angle_beta  ${cp.beta.toFixed(3)}`);
    lines.push(`_cell_angle_gamma ${cp.gamma.toFixed(3)}`);
  } else {
    // Derive cell params from lattice vectors
    const [a, b, c] = structure.lattice;
    const la = Math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2);
    const lb = Math.sqrt(b[0] ** 2 + b[1] ** 2 + b[2] ** 2);
    const lc = Math.sqrt(c[0] ** 2 + c[1] ** 2 + c[2] ** 2);
    const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const alpha = Math.acos(dot(b, c) / (lb * lc)) * 180 / Math.PI;
    const beta = Math.acos(dot(a, c) / (la * lc)) * 180 / Math.PI;
    const gamma = Math.acos(dot(a, b) / (la * lb)) * 180 / Math.PI;
    lines.push(`_cell_length_a   ${la.toFixed(6)}`);
    lines.push(`_cell_length_b   ${lb.toFixed(6)}`);
    lines.push(`_cell_length_c   ${lc.toFixed(6)}`);
    lines.push(`_cell_angle_alpha ${alpha.toFixed(3)}`);
    lines.push(`_cell_angle_beta  ${beta.toFixed(3)}`);
    lines.push(`_cell_angle_gamma ${gamma.toFixed(3)}`);
  }
  lines.push('');

  if (structure.spaceGroup) {
    lines.push(`_symmetry_space_group_name_H-M '${structure.spaceGroup}'`);
    lines.push('');
  }

  // Convert cartesian to fractional
  const frac = cartesianToFractional(structure.lattice, structure.positions);

  lines.push('loop_');
  lines.push('_atom_site_label');
  lines.push('_atom_site_type_symbol');
  lines.push('_atom_site_fract_x');
  lines.push('_atom_site_fract_y');
  lines.push('_atom_site_fract_z');

  const counts = new Map<string, number>();
  for (let i = 0; i < structure.species.length; i++) {
    const el = structure.species[i];
    const n = (counts.get(el) || 0) + 1;
    counts.set(el, n);
    const f = frac[i];
    lines.push(`${el}${n} ${el} ${f[0].toFixed(6)} ${f[1].toFixed(6)} ${f[2].toFixed(6)}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function exportPoscar(structure: CrystalStructure): string {
  const lines: string[] = [];
  lines.push(structure.title || 'Exported structure');
  lines.push('1.0');

  for (const v of structure.lattice) {
    lines.push(`  ${v[0].toFixed(10)}  ${v[1].toFixed(10)}  ${v[2].toFixed(10)}`);
  }

  // Group species
  const order: string[] = [];
  const groups = new Map<string, number[]>();
  for (let i = 0; i < structure.species.length; i++) {
    const el = structure.species[i];
    if (!groups.has(el)) {
      order.push(el);
      groups.set(el, []);
    }
    groups.get(el)!.push(i);
  }

  lines.push(order.join(' '));
  lines.push(order.map(el => groups.get(el)!.length).join(' '));
  lines.push('Cartesian');

  for (const el of order) {
    for (const idx of groups.get(el)!) {
      const p = structure.positions[idx];
      lines.push(`  ${p[0].toFixed(10)}  ${p[1].toFixed(10)}  ${p[2].toFixed(10)}`);
    }
  }

  return lines.join('\n') + '\n';
}

function cartesianToFractional(
  lattice: [number, number, number][],
  positions: [number, number, number][]
): [number, number, number][] {
  const a = lattice[0], b = lattice[1], c = lattice[2];
  const det = a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(det) < 1e-10) return positions.map(() => [0, 0, 0]);
  const invDet = 1 / det;
  const inv = [
    [(b[1] * c[2] - b[2] * c[1]) * invDet, (a[2] * c[1] - a[1] * c[2]) * invDet, (a[1] * b[2] - a[2] * b[1]) * invDet],
    [(b[2] * c[0] - b[0] * c[2]) * invDet, (a[0] * c[2] - a[2] * c[0]) * invDet, (a[2] * b[0] - a[0] * b[2]) * invDet],
    [(b[0] * c[1] - b[1] * c[0]) * invDet, (a[1] * c[0] - a[0] * c[1]) * invDet, (a[0] * b[1] - a[1] * b[0]) * invDet],
  ];
  // Transpose application: f_i = sum_j inv[j][i] * cart[j]
  return positions.map(p => [
    inv[0][0] * p[0] + inv[1][0] * p[1] + inv[2][0] * p[2],
    inv[0][1] * p[0] + inv[1][1] * p[1] + inv[2][1] * p[2],
    inv[0][2] * p[0] + inv[1][2] * p[1] + inv[2][2] * p[2],
  ]);
}
