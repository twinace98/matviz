/**
 * v0.17.1 (17.3.0) — Nearest-neighbor atom matching for comparison mode.
 *
 * Given two structures (primary and secondary), find which secondary atom
 * each primary atom corresponds to, restricted to same-species pairs and
 * a distance threshold. Greedy NN with spatial-bin acceleration for large
 * N. Output is a list of (a, b, displacement) triples plus the indices of
 * primary atoms that found no acceptable match.
 *
 * Algorithm choice:
 * - Greedy NN (not Hungarian/optimal-assignment) — handles 90%+ workflow
 *   (relaxed/unrelaxed pairs, before/after MD frames). Optimal assignment
 *   is O(N³) and over-engineered for visualization.
 * - Spatial bin O(N) for N>100; naive O(N²) for small N (avoids bin
 *   overhead).
 * - usedSecondary set ensures one-to-one matching (no two primary atoms
 *   pull the same secondary).
 */

export interface DisplacementPair {
  a: number;                              // primary atom index
  b: number;                              // secondary atom index
  displacement: [number, number, number]; // posB − posA, cartesian
}

export interface MatchResult {
  pairs: DisplacementPair[];
  unmatched: number[];                    // primary indices that found no match
}

const SPATIAL_BIN_THRESHOLD = 100;        // use bin for N above this
const DEFAULT_DISTANCE_THRESHOLD = 2.0;   // Å

/**
 * v0.17.2.2 — `lattice` parameter activates periodic-boundary handling. When
 * provided (and non-degenerate), each candidate displacement is reduced via
 * the minimum-image convention: d_frac = inv(lattice) · d,
 * d_frac → d_frac − round(d_frac), d = lattice · d_frac. This collapses
 * cell-wrapping displacements (e.g. atom at frac 0.99 vs frac 0.01 → ~0
 * after wrap, not ~a). Spatial bin is bypassed when lattice is provided —
 * binning with PBC needs neighbor-bin wraparound that doubles complexity;
 * NN cap (renderer 5k auto-disable) keeps O(N²) tractable.
 */
export function matchByNN(
  primarySpecies: string[],
  primaryPos: [number, number, number][],
  secondarySpecies: string[],
  secondaryPos: [number, number, number][],
  threshold: number = DEFAULT_DISTANCE_THRESHOLD,
  lattice?: [number, number, number][],
): MatchResult {
  const pairs: DisplacementPair[] = [];
  const unmatched: number[] = [];
  const thresholdSq = threshold * threshold;
  const usedSecondary = new Set<number>();

  // Group secondary indices by species for restricted search.
  const secondaryBySpecies = new Map<string, number[]>();
  for (let i = 0; i < secondarySpecies.length; i++) {
    const s = secondarySpecies[i];
    let list = secondaryBySpecies.get(s);
    if (!list) { list = []; secondaryBySpecies.set(s, list); }
    list.push(i);
  }

  // Spatial bin for large N (per species). Disabled when PBC active.
  const usePBC = lattice !== undefined && latticeIsValid(lattice);
  const binMap = new Map<string, BinIndex>();
  if (!usePBC) {
    for (const [species, indices] of secondaryBySpecies) {
      if (indices.length > SPATIAL_BIN_THRESHOLD) {
        binMap.set(species, buildBinIndex(indices, secondaryPos, threshold));
      }
    }
  }

  for (let a = 0; a < primarySpecies.length; a++) {
    const species = primarySpecies[a];
    const candidates = secondaryBySpecies.get(species);
    if (!candidates || candidates.length === 0) {
      unmatched.push(a);
      continue;
    }

    let bestIdx = -1;
    let bestDistSq = thresholdSq;
    let bestDispl: [number, number, number] = [0, 0, 0];

    const bin = binMap.get(species);
    const searchSet = bin ? queryBinIndex(bin, primaryPos[a], secondaryPos) : candidates;
    for (const b of searchSet) {
      if (usedSecondary.has(b)) continue;
      let dx = secondaryPos[b][0] - primaryPos[a][0];
      let dy = secondaryPos[b][1] - primaryPos[a][1];
      let dz = secondaryPos[b][2] - primaryPos[a][2];
      if (usePBC) {
        const wrapped = applyMinimumImage(dx, dy, dz, lattice!);
        dx = wrapped[0]; dy = wrapped[1]; dz = wrapped[2];
      }
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIdx = b;
        bestDispl = [dx, dy, dz];
      }
    }

    if (bestIdx === -1) {
      unmatched.push(a);
      continue;
    }
    usedSecondary.add(bestIdx);
    pairs.push({ a, b: bestIdx, displacement: bestDispl });
  }

  return { pairs, unmatched };
}

/**
 * Minimum-image displacement under PBC. Inputs: raw cartesian dx, dy, dz
 * + 3 lattice row vectors. Output: cartesian displacement collapsed to
 * (-0.5, 0.5] in each fractional coordinate (the nearest periodic image).
 */
function applyMinimumImage(dx: number, dy: number, dz: number, lattice: [number, number, number][]): [number, number, number] {
  const a = lattice[0], b = lattice[1], c = lattice[2];
  const det = a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
  if (Math.abs(det) < 1e-10) return [dx, dy, dz];
  const inv = 1 / det;
  // cartToFrac (same formula as cifParser):
  let fx = ((b[1]*c[2]-b[2]*c[1])*dx + (b[2]*c[0]-b[0]*c[2])*dy + (b[0]*c[1]-b[1]*c[0])*dz) * inv;
  let fy = ((a[2]*c[1]-a[1]*c[2])*dx + (a[0]*c[2]-a[2]*c[0])*dy + (a[1]*c[0]-a[0]*c[1])*dz) * inv;
  let fz = ((a[1]*b[2]-a[2]*b[1])*dx + (a[2]*b[0]-a[0]*b[2])*dy + (a[0]*b[1]-a[1]*b[0])*dz) * inv;
  fx -= Math.round(fx);
  fy -= Math.round(fy);
  fz -= Math.round(fz);
  return [
    fx*a[0] + fy*b[0] + fz*c[0],
    fx*a[1] + fy*b[1] + fz*c[1],
    fx*a[2] + fy*b[2] + fz*c[2],
  ];
}

function latticeIsValid(lattice: [number, number, number][]): boolean {
  if (lattice.length !== 3) return false;
  const a = lattice[0], b = lattice[1], c = lattice[2];
  const det = a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
  return Math.abs(det) > 1e-9;
}

// ---- Spatial bin (for species with >100 atoms) ----

interface BinIndex {
  bins: Map<string, number[]>;            // bin key → secondary indices
  binSize: number;                        // Å per axis
}

function binKey(x: number, y: number, z: number, binSize: number): string {
  return `${Math.floor(x / binSize)},${Math.floor(y / binSize)},${Math.floor(z / binSize)}`;
}

function buildBinIndex(indices: number[], positions: [number, number, number][], threshold: number): BinIndex {
  // Bin size = threshold so we only need own bin + 26 neighbors to cover
  // a sphere of radius `threshold` around any query point.
  const binSize = Math.max(threshold, 1.0);
  const bins = new Map<string, number[]>();
  for (const i of indices) {
    const p = positions[i];
    const key = binKey(p[0], p[1], p[2], binSize);
    let list = bins.get(key);
    if (!list) { list = []; bins.set(key, list); }
    list.push(i);
  }
  return { bins, binSize };
}

function queryBinIndex(idx: BinIndex, query: [number, number, number], _positions: [number, number, number][]): number[] {
  const result: number[] = [];
  const bx = Math.floor(query[0] / idx.binSize);
  const by = Math.floor(query[1] / idx.binSize);
  const bz = Math.floor(query[2] / idx.binSize);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${bx + dx},${by + dy},${bz + dz}`;
        const list = idx.bins.get(key);
        if (list) result.push(...list);
      }
    }
  }
  return result;
}
