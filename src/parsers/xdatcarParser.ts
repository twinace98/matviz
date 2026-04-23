import { CrystalStructure, CrystalTrajectory } from './types';

/**
 * v0.17.1.2 — VASP XDATCAR parser (MD trajectory).
 *
 * Two flavors share the same file format:
 *   NVE (fixed-cell):  one header (title, scale, 3 lattice vectors, species,
 *                      counts), then repeated `Direct configuration=N` blocks.
 *   NPT (variable-cell): the entire header is repeated before each
 *                      `Direct configuration=` block (VASP convention).
 *
 * Detection: after each Direct config block ends, peek for a line that is
 * a single positive scale number followed by 3 lattice-vector lines. If
 * found, treat as NPT (latticeMode='per-frame'). Otherwise the next
 * `Direct configuration=` continues using the prior lattice.
 *
 * Output:
 *   - latticeMode='fixed' for NVE — every frame shares the lattice REFERENCE.
 *   - latticeMode='per-frame' for NPT — each frame holds its own lattice.
 *
 * Single-frame entry (parseXdatcar) returns the first configuration's
 * CrystalStructure — used by code paths that don't need the full trajectory
 * (CLI renderer, regression test scripts).
 */

interface Header {
  scale: number;
  lattice: [number, number, number][];
  species: string[];
  counts: number[];
  posStart: number;        // line index after the header ends (selective dynamics + coord-mode line still ahead in single-frame POSCAR; XDATCAR has no selective-dynamics line — Direct/Cart at posStart)
}

function parseHeader(lines: string[], start: number): Header {
  // Layout (XDATCAR): line[start]=title, [start+1]=scale, [start+2..4]=lattice,
  //                   [start+5]=species names (VASP5+), [start+6]=counts
  // Skip blank lines defensively.
  let i = start;
  while (i < lines.length && lines[i].trim().length === 0) i++;
  const titleLine = lines[i++];
  while (i < lines.length && lines[i].trim().length === 0) i++;
  const scale = parseFloat(lines[i++].trim());
  const lattice: [number, number, number][] = [];
  for (let v = 0; v < 3; v++) {
    while (i < lines.length && lines[i].trim().length === 0) i++;
    const tokens = lines[i++].trim().split(/\s+/).map(Number);
    lattice.push([tokens[0] * scale, tokens[1] * scale, tokens[2] * scale]);
  }
  while (i < lines.length && lines[i].trim().length === 0) i++;
  const speciesLine = lines[i++].trim();
  const speciesTokens = speciesLine.split(/\s+/);
  let species: string[];
  let counts: number[];
  if (speciesTokens.every(t => /^\d+$/.test(t))) {
    // VASP4: species line is actually counts. Use title for symbols.
    counts = speciesTokens.map(Number);
    species = titleLine.trim().split(/\s+/).filter(t => /^[A-Z][a-z]?$/.test(t));
    if (species.length !== counts.length) {
      // Fallback to placeholder symbols
      species = counts.map((_, k) => `X${k + 1}`);
    }
  } else {
    species = speciesTokens;
    while (i < lines.length && lines[i].trim().length === 0) i++;
    counts = lines[i++].trim().split(/\s+/).map(Number);
  }
  return { scale, lattice, species, counts, posStart: i };
}

function buildAtomList(species: string[], counts: number[]): string[] {
  const out: string[] = [];
  for (let s = 0; s < species.length; s++) {
    for (let c = 0; c < counts[s]; c++) out.push(species[s]);
  }
  return out;
}

function fracToCart(lat: [number, number, number][], fx: number, fy: number, fz: number): [number, number, number] {
  return [
    fx * lat[0][0] + fy * lat[1][0] + fz * lat[2][0],
    fx * lat[0][1] + fy * lat[1][1] + fz * lat[2][1],
    fx * lat[0][2] + fy * lat[1][2] + fz * lat[2][2],
  ];
}

/**
 * Trajectory entry. Always returns a CrystalTrajectory; single-frame XDATCAR
 * (rare — usually you'd use POSCAR for that) becomes a length-1 trajectory.
 */
export function parseXdatcarTraj(content: string): CrystalTrajectory {
  const lines = content.split('\n');
  if (lines.length < 7) {
    throw new Error('XDATCAR too short — missing header');
  }

  const header = parseHeader(lines, 0);
  let currentLattice = header.lattice;
  let allSpecies = buildAtomList(header.species, header.counts);
  const N = allSpecies.length;
  if (N === 0) throw new Error('XDATCAR header parsed but atom count = 0');

  let latticeMode: 'fixed' | 'per-frame' = 'fixed';
  const frames: CrystalStructure[] = [];
  let i = header.posStart;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.length === 0 || line.startsWith('#')) { i++; continue; }

    if (line.startsWith('Direct configuration=') || line.startsWith('Cartesian configuration=')) {
      const isDirect = line.startsWith('Direct');
      i++;
      const positions: [number, number, number][] = [];
      for (let j = 0; j < N; j++) {
        if (i + j >= lines.length) {
          throw new Error(`XDATCAR: frame ${frames.length + 1} truncated (expected ${N} atoms)`);
        }
        const tokens = lines[i + j].trim().split(/\s+/).map(Number);
        const x = tokens[0], y = tokens[1], z = tokens[2];
        positions.push(isDirect
          ? fracToCart(currentLattice, x, y, z)
          : [x * header.scale, y * header.scale, z * header.scale]);
      }
      i += N;
      frames.push({
        lattice: currentLattice,
        species: [...allSpecies],
        positions,
        pbc: [true, true, true],
      });
      continue;
    }

    // NPT header repeat detection: peek for "scale + 3 vectors" pattern.
    const peekTokens = line.split(/\s+/);
    if (peekTokens.length === 1 && /^[+-]?\d+\.?\d*([eE][+-]?\d+)?$/.test(peekTokens[0])) {
      const peekLat: [number, number, number][] = [];
      let valid = true;
      for (let v = 1; v <= 3; v++) {
        const probe = (lines[i + v] || '').trim().split(/\s+/).map(Number);
        if (probe.length < 3 || probe.some(n => !Number.isFinite(n))) { valid = false; break; }
        peekLat.push([probe[0], probe[1], probe[2]]);
      }
      if (valid) {
        // Variable-cell repeated header
        latticeMode = 'per-frame';
        const newScale = parseFloat(peekTokens[0]);
        currentLattice = peekLat.map(v => [v[0] * newScale, v[1] * newScale, v[2] * newScale]) as [number,number,number][];
        i += 4;
        // Optional species + counts (VASP 5+) — detect by checking if next
        // non-blank line has alphabetic species token.
        while (i < lines.length && lines[i].trim().length === 0) i++;
        const peekNext = (lines[i] || '').trim();
        const nextTokens = peekNext.split(/\s+/);
        if (peekNext && !peekNext.startsWith('Direct') && !peekNext.startsWith('Cartesian')
            && nextTokens.length > 0 && /^[A-Z]/.test(nextTokens[0])) {
          // Species names line
          allSpecies = buildAtomList(nextTokens, []);  // counts not yet known
          i++;
          // Counts line
          while (i < lines.length && lines[i].trim().length === 0) i++;
          const countTokens = (lines[i] || '').trim().split(/\s+/).map(Number);
          allSpecies = buildAtomList(nextTokens, countTokens);
          i++;
          if (allSpecies.length !== N) {
            // Atom count drift — VASP NPT shouldn't change this. Throw to surface.
            throw new Error(`XDATCAR variable-cell: atom count changed mid-file (${N} → ${allSpecies.length})`);
          }
        }
        continue;
      }
    }

    i++;
  }

  if (frames.length === 0) {
    throw new Error('XDATCAR: no Direct configuration blocks found');
  }
  return { frames, latticeMode };
}

/**
 * Single-frame entry — first configuration's CrystalStructure. Used by code
 * paths that don't need the full trajectory.
 */
export function parseXdatcar(content: string): CrystalStructure {
  const traj = parseXdatcarTraj(content);
  return traj.frames[0];
}
