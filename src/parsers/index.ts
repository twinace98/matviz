import { CrystalStructure, CrystalTrajectory, VolumetricData, VolumetricLoadOptions, decimateVolumetric } from './types';
import { detectSymmetry, isSpglibReady } from '../shared/spglibWasm';
import { parseCif } from './cifParser';
import { parsePoscar } from './poscarParser';
import { parseXsf, parseXsfTraj, parseXsfFromBytes } from './xsfParser';
import { parseXdatcar, parseXdatcarTraj } from './xdatcarParser';
import { parseChgcar, parseChgcarFromBytes } from './chgcarParser';
import { parseCube, parseCubeFromBytes } from './cubeParser';
import { parseXyz, parseXyzTraj } from './xyzParser';
import { parsePdb } from './pdbParser';
import { parseQE } from './qeParser';
import { parseAims } from './aimsParser';

export interface ParseResult {
  structure: CrystalStructure;
  // v0.23 multi-grid: `volumetrics` is the canonical list; `volumetric`
  // is a back-compat alias === `volumetrics?.[0]`. Single-grid parsers
  // (v0.22 and earlier behavior) populate exactly one entry.
  volumetric?: VolumetricData;
  volumetrics?: VolumetricData[];
}

export interface ParseTrajectoryResult {
  trajectory: CrystalTrajectory;
  volumetric?: VolumetricData;  // back-compat alias === volumetrics?.[0]
  volumetrics?: VolumetricData[];  // first-frame volumetric grids only
}

/**
 * v0.23 — normalize a single-grid parse result into the multi-grid list.
 * When a parser produced exactly one `volumetric` and no `volumetrics`
 * list yet, wrap it into a length-1 list and give it a default name so
 * the grid-selection UI (v0.23.4) has a label. Byte-identical to the
 * pre-v0.23 path: the grid `data` is untouched. Parsers that already
 * emit a `volumetrics` list (XSF multi-block v0.23.2, CHGCAR spin
 * v0.23.3) are left as-is.
 */
function attachGridList<T extends { volumetric?: VolumetricData; volumetrics?: VolumetricData[] }>(
  r: T, filename: string,
): T {
  if (r.volumetrics && r.volumetrics.length > 0) {
    r.volumetric = r.volumetrics[0];
    return r;
  }
  if (r.volumetric) {
    const lower = filename.toLowerCase();
    const isChg = lower === 'chgcar' || lower === 'aeccar0' || lower === 'aeccar2' || lower === 'parchg';
    const named: VolumetricData = {
      ...r.volumetric,
      name: r.volumetric.name ?? (isChg ? 'charge' : 'density'),
      kind: r.volumetric.kind ?? 'scalar',
    };
    r.volumetric = named;
    r.volumetrics = [named];
  }
  return r;
}

/**
 * v0.22 Tier 3 string-path cap, applied to EVERY grid. v0.23.1 fix: only
 * `volumetric` used to be decimated, and `attachGridList` then replaced it
 * with the untouched `volumetrics[0]` — so the user cap silently did nothing
 * for XSF / CHGCAR (multi-grid capable) files under the byte-path threshold.
 */
function decimateGrids<T extends { volumetric?: VolumetricData; volumetrics?: VolumetricData[] }>(
  r: T, options?: VolumetricLoadOptions,
): T {
  if (options?.maxGridPoints == null) return r;
  if (r.volumetrics && r.volumetrics.length > 0) {
    r.volumetrics = r.volumetrics.map(g => decimateVolumetric(g, options));
    r.volumetric = r.volumetrics[0];
  } else if (r.volumetric) {
    r.volumetric = decimateVolumetric(r.volumetric, options);
  }
  return r;
}

// Cells past this size skip spglib — analyze_cell cost is non-monotone in
// atom count (~240 ms at 216, ~7 s at 512 for diamond Fd-3m supercells).
const SYMMETRY_MAX_ATOMS = 256;

function withSymmetry(structure: CrystalStructure): CrystalStructure {
  if (!isSpglibReady()) return structure;
  if (structure.spaceGroup && structure.spaceGroup !== 'P1') return structure;
  if (structure.species.length === 0) return structure;
  if (structure.species.length > SYMMETRY_MAX_ATOMS) return structure;
  const sym = detectSymmetry(structure.lattice, structure.positions, structure.species);
  if (!sym) return structure;
  return {
    ...structure,
    spaceGroup: sym.spaceGroup,
    spaceGroupNumber: sym.spaceGroupNumber,
    hallNumber: sym.hallNumber,
  };
}

function withSymmetryResult(r: ParseResult): ParseResult {
  return { ...r, structure: withSymmetry(r.structure) };
}

export function parseStructureFile(
  content: string, filename: string, options?: VolumetricLoadOptions,
): ParseResult {
  const r = withSymmetryResult(parseStructureFileRaw(content, filename));
  // v0.22 Tier 3: user-set `maxGridPoints` applies in the string path too,
  // as a "fast-render" preference. Null/undefined leaves the grid alone
  // (the safety default cap is byte-path-only since small files cannot
  // hit the 4 GiB ArrayBuffer ceiling).
  return attachGridList(decimateGrids({ ...r }, options), filename);
}

function parseStructureFileRaw(content: string, filename: string): ParseResult {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.cif')) {
    return { structure: parseCif(content) };
  }
  if (lower.endsWith('.xsf') || lower.endsWith('.axsf')) {
    const result = parseXsf(content);
    const { volumetric, volumetrics, ...structure } = result;
    return { structure, volumetric, volumetrics };
  }
  if (lower.endsWith('.cube') || lower.endsWith('.cub')) {
    const result = parseCube(content);
    return result;
  }
  if (lower.endsWith('.xyz')) {
    return { structure: parseXyz(content) };
  }
  if (lower.endsWith('.pdb') || lower.endsWith('.ent')) {
    return { structure: parsePdb(content) };
  }
  if (
    lower.endsWith('.out') ||
    lower.endsWith('.pw') ||
    lower.endsWith('.stdout') ||
    lower.endsWith('.stdin')
  ) {
    return { structure: parseQE(content) };
  }
  if (lower === 'geometry.in' || lower.endsWith('.in')) {
    // FHI-aims signature
    if (content.includes('atom ') || content.includes('lattice_vector')) {
      return { structure: parseAims(content) };
    }
    // Otherwise treat as Quantum ESPRESSO input
    return { structure: parseQE(content) };
  }
  if (
    lower.endsWith('.poscar') ||
    lower.endsWith('.vasp') ||
    lower === 'poscar' ||
    lower === 'contcar'
  ) {
    return { structure: parsePoscar(content) };
  }
  if (lower === 'xdatcar') {
    return { structure: parseXdatcar(content) };
  }
  if (lower === 'chgcar' || lower === 'aeccar0' || lower === 'aeccar2' || lower === 'parchg') {
    const result = parseChgcar(content);
    return result;
  }

  // Auto-detection
  if (content.includes('_cell_length_a') || content.includes('_atom_site')) {
    return { structure: parseCif(content) };
  }
  if (content.includes('PRIMVEC') || content.includes('PRIMCOORD') || content.includes('CRYSTAL')) {
    const result = parseXsf(content);
    const { volumetric, volumetrics, ...structure } = result;
    return { structure, volumetric, volumetrics };
  }

  // Default: try POSCAR
  return { structure: parsePoscar(content) };
}

export { CrystalStructure, CrystalTrajectory, VolumetricData } from './types';

// Trajectory-aware entry point. Single-frame formats wrap into a length-1
// trajectory; symmetry is detected on frame 0 only and copied to the rest
// to avoid per-frame jitter.
export function parseStructureFileTraj(
  content: string, filename: string, options?: VolumetricLoadOptions,
): ParseTrajectoryResult {
  const r = parseStructureFileTrajRaw(content, filename);
  // v0.22 Tier 3: same "user-set cap applies" rule as parseStructureFile.
  decimateGrids(r, options);
  attachGridList(r, filename);
  if (r.trajectory.frames.length > 0) {
    const f0 = withSymmetry(r.trajectory.frames[0]);
    r.trajectory.frames[0] = f0;
    if (f0.spaceGroup && r.trajectory.frames.length > 1) {
      for (let i = 1; i < r.trajectory.frames.length; i++) {
        r.trajectory.frames[i] = {
          ...r.trajectory.frames[i],
          spaceGroup: f0.spaceGroup,
          spaceGroupNumber: f0.spaceGroupNumber,
          hallNumber: f0.hallNumber,
        };
      }
    }
  }
  return r;
}

/**
 * Byte-path entry point (v0.22 Tier 2). Mirrors `parseStructureFileTraj`
 * for volumetric formats whose ASCII size exceeds Node's MAX_STRING_LENGTH
 * (~512 MiB on x64), where calling `TextDocument.getText()` throws
 * `RangeError: Invalid string length`. Supported formats: Gaussian Cube,
 * XSF (single-frame BLOCK_DATAGRID_3D), CHGCAR-family.
 */
export function parseStructureFileTrajFromBytes(
  bytes: Uint8Array,
  filename: string,
  options?: VolumetricLoadOptions,
): ParseTrajectoryResult {
  const lower = filename.toLowerCase();
  let result: ParseResult;
  if (lower.endsWith('.xsf') || lower.endsWith('.axsf')) {
    const r = parseXsfFromBytes(bytes, options);
    const { volumetric, volumetrics, ...structure } = r;
    result = { structure: structure as CrystalStructure, volumetric, volumetrics };
  } else if (lower.endsWith('.cube') || lower.endsWith('.cub')) {
    result = parseCubeFromBytes(bytes, options);
  } else if (lower === 'chgcar' || lower === 'aeccar0' || lower === 'aeccar2' || lower === 'parchg') {
    result = parseChgcarFromBytes(bytes, options);
  } else {
    throw new Error(`parseStructureFileTrajFromBytes: unsupported byte-path format ${filename}`);
  }
  const f0 = withSymmetry(result.structure);
  // v0.23.1 fix: forward the full grid list. Passing only `volumetric` here
  // collapsed CHGCAR spin/SOC and multi-DATAGRID XSF to their first grid on
  // the byte path (files ≥ 256 MiB).
  return attachGridList({
    trajectory: { frames: [f0], latticeMode: 'fixed' },
    volumetric: result.volumetric,
    volumetrics: result.volumetrics,
  }, filename);
}

/**
 * Shared tail of the byte path and the Node-only streaming parser
 * (`volumetricStream.ts`, v0.23.1): symmetry on the structure, then the
 * named-grid list. Lives here because `withSymmetry` / `attachGridList` are
 * private to this module.
 */
export function finalizeVolumetricResult(
  structure: CrystalStructure,
  volumetrics: VolumetricData[],
  filename: string,
): ParseTrajectoryResult {
  const f0 = withSymmetry(structure);
  // A lone unnamed grid (cube) goes in as `volumetric` so attachGridList names
  // it ('density' / 'charge') exactly as the string path does.
  const named = volumetrics.length > 1 || (volumetrics.length === 1 && volumetrics[0].name != null);
  return attachGridList({
    trajectory: { frames: [f0], latticeMode: 'fixed' },
    volumetric: volumetrics[0],
    volumetrics: named ? volumetrics : undefined,
  }, filename);
}

/** File extensions that have a byte-path parser available. */
export function hasBytePath(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith('.xsf') || lower.endsWith('.axsf') ||
    lower.endsWith('.cube') || lower.endsWith('.cub') ||
    lower === 'chgcar' || lower === 'aeccar0' || lower === 'aeccar2' || lower === 'parchg'
  );
}

function parseStructureFileTrajRaw(content: string, filename: string): ParseTrajectoryResult {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.xsf') || lower.endsWith('.axsf')) {
    return parseXsfTraj(content);
  }
  if (lower === 'xdatcar') {
    return { trajectory: parseXdatcarTraj(content) };
  }
  if (lower.endsWith('.xyz')) {
    return { trajectory: parseXyzTraj(content) };
  }
  // Content-based fallback for trajectory files with non-standard names.
  if (content.includes('Direct configuration=') || content.includes('Cartesian configuration=')) {
    return { trajectory: parseXdatcarTraj(content) };
  }
  if (content.includes('ANIMSTEPS')) {
    return parseXsfTraj(content);
  }

  // Single-frame fallback wrapped as length-1 trajectory. v0.23: forward the
  // full named-grid list (CHGCAR spin, multi-DATAGRID) — dropping `volumetrics`
  // here silently collapses multi-grid files back to a single grid.
  const single = parseStructureFile(content, filename);
  return {
    trajectory: { frames: [single.structure], latticeMode: 'fixed' },
    volumetric: single.volumetric,
    volumetrics: single.volumetrics,
  };
}
