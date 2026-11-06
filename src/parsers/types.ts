import { tentDownsample } from './downsample';

export interface CrystalStructure {
  lattice: [number, number, number][];  // 3 lattice vectors in Angstroms
  species: string[];                     // element symbol per atom
  positions: [number, number, number][]; // cartesian positions in Angstroms
  pbc: [boolean, boolean, boolean];
  title?: string;
  spaceGroup?: string;          // Hermann-Mauguin (compact form: "Fd-3m")
  spaceGroupNumber?: number;    // 1..230
  hallNumber?: number;          // 1..530
  cellParams?: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };
  symmetryOps?: string[];  // e.g., ["x,y,z", "-x+1/2,y,-z+1/2"]

  // Optional per-atom extensions — populated by parsers when source data carries
  // them. When present, array length must equal species.length.
  //
  // Anisotropic displacement parameters Uᵢⱼ in Å². `null` entry means "no aniso
  // data for this atom" — use isotropic sphere for that site even when other
  // atoms have ellipsoids.
  thermalAniso?: Array<{ U11: number; U22: number; U33: number; U12: number; U13: number; U23: number } | null>;
  // Partial occupancy 0..1 per atom. Atoms with occupancy < 1.0 may share
  // coordinates with other species (mixed sites). Default behavior renders
  // only the dominant species per site.
  occupancy?: number[];
  // Per-atom vector overlay. `kind` tags semantic origin; renderer is agnostic.
  // `label`/`unit` decorate the side-panel UI. `values` is one Cartesian vector
  // per atom; [0,0,0] means no overlay for that atom.
  atomVectors?: AtomVectorField;
}

export interface AtomVectorField {
  kind: 'magmom' | 'force' | 'velocity' | 'displacement' | 'generic';
  label?: string;
  unit?: string;
  values: Array<[number, number, number]>;
}

export interface VolumetricData {
  origin: [number, number, number];
  lattice: [number, number, number][];
  dims: [number, number, number];          // dims after any v0.22 Tier 3 stride
  data: Float32Array;
  // v0.23 multi-grid model. A structure may carry several named grids
  // (CHGCAR charge/magnetization/spin_up·down/σ components, or multiple
  // XSF BEGIN_DATAGRID_3D blocks). `name` is the UI label + `--grid`
  // selector key; absent name ≡ the sole/primary grid. `kind` drives the
  // default sign policy in v0.24 (signed grids default to ± isosurfaces);
  // absent ≡ 'scalar'. Both additive — single-grid loads leave them unset.
  name?: string;
  kind?: 'scalar' | 'signed';
  // v0.22 Tier 3 — populated when load-time downsampling was applied. `stride`
  // is the integer skip factor along each axis (1 = no decimation); when stride
  // > 1, `originalDims` holds the pre-decimation grid shape so UI can show
  // "300³ → 150³ (stride 2)". Both fields absent on stride-1 loads.
  stride?: number;
  originalDims?: [number, number, number];
}

/**
 * v0.22 Tier 3 options. Passed from `crystalEditorProvider` (which reads the
 * VSCode setting `matviz.volumetric.maxGridPoints`) down to the *FromBytes
 * parsers so they can choose a stride before allocating the result
 * Float32Array. Choosing the stride during ingestion (rather than as a
 * post-process) is the only way to handle grids that would otherwise blow
 * the 4 GiB ArrayBuffer ceiling — the full-resolution Float32Array is never
 * materialized in that case.
 */
export interface VolumetricLoadOptions {
  /**
   * Cap on `dims[0] * dims[1] * dims[2]` after decimation. The parser picks
   * the smallest integer stride satisfying the cap. `null` falls back to a
   * safety default chosen well below the 4 GiB ArrayBuffer limit.
   */
  maxGridPoints?: number | null;
}

/**
 * Default per-axis cap on grid points. 4×10⁸ ≈ 730³, 1.6 GB of Float32 —
 * roughly half the 4 GiB ArrayBuffer ceiling, leaving headroom for the
 * source Uint8Array, V8 internal allocations, and the webview's own copy
 * post-structured-clone. Tuned to never auto-OOM on a 32 GB workstation.
 */
export const VOLUMETRIC_SAFETY_MAX_GRID_POINTS = 4e8;

/**
 * Pick the smallest integer `stride ≥ 1` such that decimating an `nx×ny×nz`
 * grid down to `ceil(nx/stride) * ceil(ny/stride) * ceil(nz/stride)` points
 * does not exceed `maxGridPoints`. Returns 1 when the source already fits.
 */
export function chooseStride(
  nx: number, ny: number, nz: number, maxGridPoints: number,
): number {
  let s = 1;
  while (
    Math.ceil(nx / s) * Math.ceil(ny / s) * Math.ceil(nz / s) > maxGridPoints
  ) {
    s++;
  }
  return s;
}

/**
 * Post-parse decimation. Used by the string-path (small files) when the
 * user has set an explicit `maxGridPoints` cap — in that case the cap is
 * a user preference for fast rendering, not a memory-safety fallback, and
 * should apply regardless of file size.
 *
 * Skips work when `options.maxGridPoints` is null/undefined or when the
 * source already fits. The result's `stride` field composes with any
 * stride the byte path may have already applied (so a byte-path 1024³ →
 * 512³ load followed by a user-set further-cap decimation correctly
 * reports the cumulative stride).
 */
export function decimateVolumetric(
  v: VolumetricData, options?: VolumetricLoadOptions,
): VolumetricData {
  const cap = options?.maxGridPoints;
  if (cap == null) return v;
  const [nx, ny, nz] = v.dims;
  const stride = chooseStride(nx, ny, nz, cap);
  if (stride <= 1) return v;
  // v0.23.1: tent splat (see downsample.ts) instead of keeping every s-th
  // sample — point sampling drifted the grid when N % s ≠ 0. String-path
  // grids are already trimmed of XSF periodic-closure planes, so no skip.
  const outDims: [number, number, number] = [
    Math.ceil(nx / stride), Math.ceil(ny / stride), Math.ceil(nz / stride),
  ];
  return {
    ...v,
    dims: outDims,
    data: tentDownsample(v.data, v.dims, outDims),
    stride: (v.stride ?? 1) * stride,
    originalDims: v.originalDims ?? [nx, ny, nz],
  };
}

/**
 * Multi-frame wrapper. Single-frame files wrap into a length-1 trajectory
 * so all downstream code can iterate uniformly.
 *
 * Invariants (parser-enforced):
 * - frames.length ≥ 1
 * - frames[i].species.length is identical across all i (atom invariance)
 * - frames[i].positions.length === frames[i].species.length
 * - latticeMode === 'fixed' ⇒ frames[i].lattice === frames[0].lattice
 *   (object reference equality so renderer can short-circuit cell rebuild)
 */
export interface CrystalTrajectory {
  frames: CrystalStructure[];
  latticeMode: 'fixed' | 'per-frame';
}
