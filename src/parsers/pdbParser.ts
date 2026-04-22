import { CrystalStructure } from './types';

export function parsePdb(content: string): CrystalStructure {
  const lines = content.split('\n');

  let lattice: [number, number, number][] = [[20, 0, 0], [0, 20, 0], [0, 0, 20]];
  let pbc: [boolean, boolean, boolean] = [false, false, false];
  let title = '';

  const species: string[] = [];
  const positions: [number, number, number][] = [];

  for (const line of lines) {
    const record = line.substring(0, 6).trim();

    if (record === 'TITLE') {
      title = line.substring(10).trim();
    }

    if (record === 'CRYST1') {
      // PDB CRYST1 record: a, b, c, alpha, beta, gamma
      const a = parseFloat(line.substring(6, 15));
      const b = parseFloat(line.substring(15, 24));
      const c = parseFloat(line.substring(24, 33));
      const alpha = parseFloat(line.substring(33, 40));
      const beta = parseFloat(line.substring(40, 47));
      const gamma = parseFloat(line.substring(47, 54));

      lattice = cellToLattice(a, b, c, alpha, beta, gamma);
      pbc = [true, true, true];
    }

    if (record === 'ATOM' || record === 'HETATM') {
      const x = parseFloat(line.substring(30, 38));
      const y = parseFloat(line.substring(38, 46));
      const z = parseFloat(line.substring(46, 54));

      // Element symbol: columns 77-78, or extract from atom name
      let element = line.substring(76, 78).trim();
      if (!element) {
        element = line.substring(12, 16).trim().replace(/[0-9]/g, '');
      }
      element = element.charAt(0).toUpperCase() + element.slice(1).toLowerCase();

      species.push(element);
      positions.push([x, y, z]);
    }
  }

  return { lattice, species, positions, pbc, title };
}

function cellToLattice(
  a: number, b: number, c: number,
  alpha: number, beta: number, gamma: number
): [number, number, number][] {
  // Degenerate-cell guard (16.1): caught by editor parse-error boundary so
  // malformed CRYST1 records surface "Open as Text" rather than NaN positions.
  if (a < 1e-9 || b < 1e-9 || c < 1e-9) {
    throw new Error(`Degenerate lattice in CRYST1: cell length ≤ 0 (a=${a}, b=${b}, c=${c})`);
  }
  const degToRad = Math.PI / 180;
  const sinGamma = Math.sin(gamma * degToRad);
  if (Math.abs(sinGamma) < 1e-6) {
    throw new Error(`Degenerate lattice in CRYST1: gamma ≈ 0 or 180 (γ=${gamma}°), cell vectors collinear`);
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
    throw new Error(`Degenerate lattice in CRYST1: angles inconsistent (α=${alpha}°, β=${beta}°, γ=${gamma}°)`);
  }
  const cz = Math.sqrt(Math.max(0, czSq));
  const v3: [number, number, number] = [cx, cy, cz];

  return [v1, v2, v3];
}
