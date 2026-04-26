import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { parseStructureFile, parseStructureFileTraj } from '../src/parsers/index';
import { ELEMENTS, DEFAULT_ELEMENT } from '../src/shared/elements-data';

// Compact shape for embedding in the HTML template — preserves the browser-side
// key aliases (cr/vdw/dr) used by the existing template code.
const CLI_ELEMENTS = Object.fromEntries(
  Object.values(ELEMENTS).map(e => [e.symbol, {
    color: e.color,
    cr: e.covalentRadius,
    vdw: e.vdwRadius,
    dr: e.displayRadius,
  }])
);
const CLI_DEFAULT_EL = {
  color: DEFAULT_ELEMENT.color,
  cr: DEFAULT_ELEMENT.covalentRadius,
  vdw: DEFAULT_ELEMENT.vdwRadius,
  dr: DEFAULT_ELEMENT.displayRadius,
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface RenderOptions {
  input: string;
  output: string;
  width: number;
  height: number;
  style: string;
  camera: string;
  view: string;
  rotate: [number, number, number];
  supercell: [number, number, number];
  palette: string;
  bg: string;
  bonds: boolean;
  boundary: boolean;
  cell: boolean;
  labels: boolean;
  polyhedra: boolean;
  polyhedraCenters: string[] | null;
  iso: number | null;
  plane: [number, number, number] | null;
  test: boolean;
  // 16.3 magnetic moments
  magmom: boolean;
  magmomColormap: 'redblue' | 'viridis';
  magmomScale: number;
  // 16.2 partial occupancy
  partialOccupancy: boolean;
  // 16.1 thermal ellipsoids
  ellipsoids: boolean;
  ellipsoidContour: 0.5 | 0.9;
  // 16.4 Wulff
  wulff: Array<{ h: number; k: number; l: number; gamma: number }> | null;
  // v0.17.3 trajectory CLI
  frame: number;
  allFrames: boolean;
  // v0.17.4 multi-phase overlay + comparison CLI
  phases: string[];
  compareToPhase: boolean;
}

function parseArgs(argv: string[]): RenderOptions {
  const opts: RenderOptions = {
    input: '',
    output: '',
    width: 1920,
    height: 1080,
    style: 'ball-and-stick',
    camera: 'ortho',
    view: 'std',
    rotate: [0, 0, 0],
    supercell: [1, 1, 1],
    palette: 'dark',
    bg: '#1e1e1e',
    bonds: true,
    boundary: true,
    cell: true,
    labels: false,
    polyhedra: false,
    polyhedraCenters: null,
    iso: null,
    plane: null,
    test: false,
    magmom: false,
    magmomColormap: 'redblue',
    magmomScale: 1.0,
    partialOccupancy: false,
    ellipsoids: false,
    ellipsoidContour: 0.5,
    wulff: null,
    frame: 0,
    allFrames: false,
    phases: [],
    compareToPhase: false,
  };

  const args = argv.slice(2);
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--test': opts.test = true; break;
      case '-o': case '--output': opts.output = args[++i]; break;
      case '--width': opts.width = parseInt(args[++i]); break;
      case '--height': opts.height = parseInt(args[++i]); break;
      case '--style': opts.style = args[++i]; break;
      case '--camera': opts.camera = args[++i]; break;
      case '--view': opts.view = args[++i]; break;
      case '--rotate': opts.rotate = args[++i].split(',').map(Number) as [number, number, number]; break;
      case '--supercell': opts.supercell = args[++i].split(',').map(Number) as [number, number, number]; break;
      case '--palette': opts.palette = args[++i]; break;
      case '--bg': opts.bg = args[++i]; break;
      case '--no-bonds': opts.bonds = false; break;
      case '--no-boundary': opts.boundary = false; break;
      case '--no-cell': opts.cell = false; break;
      case '--labels': opts.labels = true; break;
      case '--polyhedra': opts.polyhedra = true; break;
      case '--polyhedra-centers':
        opts.polyhedraCenters = args[++i].split(',').map(s => s.trim()).filter(Boolean);
        opts.polyhedra = true;
        break;
      case '--iso': opts.iso = parseFloat(args[++i]); break;
      case '--plane': opts.plane = args[++i].split(',').map(Number) as [number, number, number]; break;
      case '--magmom': opts.magmom = true; break;
      case '--magmom-colormap': {
        const v = args[++i];
        if (v !== 'redblue' && v !== 'viridis') {
          console.error(`Invalid --magmom-colormap: ${v} (use 'redblue' or 'viridis')`);
          process.exit(1);
        }
        opts.magmomColormap = v;
        opts.magmom = true;  // implies show
        break;
      }
      case '--magmom-scale': opts.magmomScale = parseFloat(args[++i]); opts.magmom = true; break;
      case '--partial-occupancy': opts.partialOccupancy = true; break;
      case '--ellipsoids': opts.ellipsoids = true; break;
      case '--ellipsoid-contour': {
        const v = parseFloat(args[++i]);
        if (v !== 0.5 && v !== 0.9) {
          console.error(`Invalid --ellipsoid-contour: ${v} (use 0.5 or 0.9)`);
          process.exit(1);
        }
        opts.ellipsoidContour = v as 0.5 | 0.9;
        opts.ellipsoids = true;
        break;
      }
      case '--wulff': {
        // Format: "h,k,l,γ; h,k,l,γ; ..."  — semicolon-separated tuples
        const raw = args[++i];
        const planes: Array<{ h: number; k: number; l: number; gamma: number }> = [];
        for (const seg of raw.split(';')) {
          const t = seg.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
          if (t.length === 4) planes.push({ h: t[0], k: t[1], l: t[2], gamma: t[3] });
        }
        if (planes.length === 0) {
          console.error(`--wulff: no valid (h,k,l,γ) tuples parsed from "${raw}"`);
          process.exit(1);
        }
        opts.wulff = planes;
        break;
      }
      case '--frame': opts.frame = parseInt(args[++i]); break;
      case '--all-frames': opts.allFrames = true; break;
      case '--phase': opts.phases.push(args[++i]); break;
      case '--compare-to-phase': opts.compareToPhase = true; break;
      case '-h': case '--help': printHelp(); process.exit(0);
      default:
        if (!a.startsWith('-')) positional.push(a);
        else { console.error(`Unknown option: ${a}`); process.exit(1); }
    }
  }

  if (positional.length > 0) opts.input = positional[0];
  if (!opts.output && opts.input) {
    opts.output = opts.input.replace(/\.[^.]+$/, '.png');
  }
  if (!opts.output) opts.output = 'test_render.png';

  return opts;
}

function printHelp() {
  console.log(`Usage: node dist/render.js <input> [options]

Arguments:
  input                  Structure file (CIF, POSCAR, XSF, XYZ, PDB, Cube, etc.)

Options:
  -o, --output <path>    Output PNG path (default: {input_stem}.png)
  --width <n>            Image width in pixels (default: 1920)
  --height <n>           Image height in pixels (default: 1080)
  --style <s>            ball-and-stick|space-filling|stick|wireframe (default: ball-and-stick)
  --camera <c>           ortho|persp (default: ortho)
  --view <v>             a|b|c|a*|b*|c*|std (default: std)
  --rotate <x,y,z>       Additional rotation in degrees (default: 0,0,0)
  --supercell <a,b,c>    Supercell expansion (default: 1,1,1)
  --palette <p>          dark|light (default: dark)
  --bg <color>           Background hex or "transparent" (default: #1e1e1e)
  --no-bonds             Hide bonds
  --no-boundary          Hide boundary atoms
  --no-cell              Hide cell wireframe
  --labels               Show atom labels
  --polyhedra            Show coordination polyhedra (auto-selects elements with avg coord 4-8)
  --polyhedra-centers <elements>
                         Comma-separated element symbols used as polyhedra centers (e.g. Ti,Fe).
                         Implies --polyhedra. Overrides auto-detection.
  --iso <level>          Isosurface level (volumetric data only)
  --plane <h,k,l>        Add lattice plane
  --magmom               Show magnetic-moment arrows (auto-on if structure carries
                         magMom from POSCAR title MAGMOM or CIF _atom_site_moment_*)
  --magmom-colormap <c>  redblue (default; sign-coded by mz)|viridis (sequential by |m|)
  --magmom-scale <s>     Arrow length scale in Å per μB (default: 1.0)
  --partial-occupancy    Render sites with _atom_site_occupancy < 1 as transparent
                         atoms with opacity = occupancy (per-site preserved). Default
                         off — full atoms shown, mixed-site overlap hidden.
  --ellipsoids           Render thermal ellipsoids for atoms with anisotropic U
                         (CIF _atom_site_aniso_U_*). Phong-only (impostor uniform-
                         radius assumption excluded). Default off.
  --ellipsoid-contour <c> Probability contour 0.5 (default; χ²₃ ≈ 2.366) or
                         0.9 (χ²₃ ≈ 6.251). Implies --ellipsoids.
  --wulff "<spec>"       Render Wulff polytope. Spec is semicolon-separated
                         (h,k,l,γ) tuples — e.g. "1,0,0,1.0; 0,1,0,1.0;
                         0,0,1,1.0; -1,0,0,1.0; 0,-1,0,1.0; 0,0,-1,1.0" for
                         a cube. γ is per-face surface energy (relative units).
                         Polytope rendered as semi-transparent blue mesh.
  --frame <n>            For multi-frame trajectory files (XDATCAR/AXSF/
                         extended XYZ), render the 0-indexed Nth frame.
                         Default 0 (first frame). Out-of-range clamps + warns.
                         Ignored for single-frame files.
  --all-frames           Render every frame as a PNG sequence:
                         <output_base>_NNNN.png (4-digit zero-padded;
                         expands to 5-digit beyond 9999 frames). Combine
                         with ffmpeg for gif/mp4 (see SKILL.md). Conflicts
                         with --frame N — --all-frames wins + warns.
  --phase <file>         Add a secondary structure as transparent overlay.
                         Repeatable: --phase a.cif --phase b.cif. Default
                         offset (0,0,0) and opacity 0.5 (cell-overlap mode).
                         Single-frame parse (first frame for trajectory
                         phase files).
  --compare-to-phase     NN displacement comparison between primary and
                         the FIRST --phase. Renders Viridis arrows + writes
                         "[comparison] RMSD: ..." line to stdout. Requires
                         at least one --phase. Cannot combine with
                         --all-frames (use --frame N instead).
  --test                 Render test scene (red sphere)
  -h, --help             Show this help`);
}

// ---------------------------------------------------------------------------
// Generate the HTML that runs Three.js in Chromium
// ---------------------------------------------------------------------------

function generateTestHTML(opts: RenderOptions): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>* { margin: 0; padding: 0; } body { width: ${opts.width}px; height: ${opts.height}px; overflow: hidden; }</style>
</head><body>
<canvas id="c" width="${opts.width}" height="${opts.height}"></canvas>
<script type="module">
import * as THREE from '__THREE_PATH__';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(${opts.width}, ${opts.height}, false);
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
scene.background = new THREE.Color('${opts.bg}');

const camera = new THREE.OrthographicCamera(-3, 3, 3 * ${opts.height / opts.width}, -3 * ${opts.height / opts.width}, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const d = new THREE.DirectionalLight(0xffffff, 0.8);
d.position.set(5, 10, 7);
scene.add(d);

const geo = new THREE.SphereGeometry(1.5, 32, 24);
const mat = new THREE.MeshPhongMaterial({ color: 0xff4444 });
scene.add(new THREE.Mesh(geo, mat));

renderer.render(scene, camera);

window.__renderDone = true;
</script></body></html>`;
}

function generateStructureHTML(opts: RenderOptions, structureJSON: string, volumetricJSON: string | null, phasesJSON: string = '[]', compareToPhase: boolean = false): string {
  const threeURL = '__THREE_PATH__';
  const helpersURL = '__HELPERS_PATH__';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>* { margin: 0; padding: 0; } body { width: ${opts.width}px; height: ${opts.height}px; overflow: hidden; background: ${opts.bg}; }</style>
</head><body>
<canvas id="c" width="${opts.width}" height="${opts.height}"></canvas>
<script type="module">
import * as THREE from '${threeURL}';
import { marchingCubes, marchingSquaresFill, tileVolumetricPBC, ConvexGeometry } from '${helpersURL}';

const W = ${opts.width}, H = ${opts.height};
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: ${opts.bg === 'transparent'} });
renderer.setSize(W, H, false);
renderer.setPixelRatio(1);

const structure = ${structureJSON};
// v0.17.4.1 secondary phases (already-parsed, [] when no --phase given).
const phases = ${phasesJSON};
// v0.17.4.2 comparison toggle — when true, compute NN displacement
// from primary to phases[0] and render arrows + emit window.__comparisonStats
// for Node-side stdout summary.
const compareToPhase = ${compareToPhase ? 'true' : 'false'};
const volumetric = ${volumetricJSON || 'null'};
const OPTS = ${JSON.stringify({
    style: opts.style,
    camera: opts.camera,
    view: opts.view,
    rotate: opts.rotate,
    supercell: opts.supercell,
    palette: opts.palette,
    bg: opts.bg,
    bonds: opts.bonds,
    boundary: opts.boundary,
    cell: opts.cell,
    labels: opts.labels,
    polyhedra: opts.polyhedra,
    polyhedraCenters: opts.polyhedraCenters,
    iso: opts.iso,
    plane: opts.plane,
    magmom: opts.magmom,
    magmomColormap: opts.magmomColormap,
    magmomScale: opts.magmomScale,
    partialOccupancy: opts.partialOccupancy,
    ellipsoids: opts.ellipsoids,
    ellipsoidContour: opts.ellipsoidContour,
    wulff: opts.wulff,
  })};

// --- Element data (generated from src/shared/elements-data.ts) ---
const ELEMENTS = ${JSON.stringify(CLI_ELEMENTS)};
const DEFAULT_EL = ${JSON.stringify(CLI_DEFAULT_EL)};

function getEl(sym) {
  const n = sym.charAt(0).toUpperCase() + sym.slice(1).toLowerCase();
  return ELEMENTS[n] || DEFAULT_EL;
}

function brighten(hex) {
  let r = parseInt(hex.slice(1,3),16)/255;
  let g = parseInt(hex.slice(3,5),16)/255;
  let b = parseInt(hex.slice(5,7),16)/255;
  let max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max+min)/2;
  if (max===min) { h=s=0; } else {
    let d = max-min; s = l>0.5 ? d/(2-max-min) : d/(max+min);
    if (max===r) h=((g-b)/d+(g<b?6:0))/6;
    else if (max===g) h=((b-r)/d+2)/6;
    else h=((r-g)/d+4)/6;
  }
  l = Math.min(1, Math.max(0.35, l * 1.2));
  s = Math.min(1, s * 1.1);
  function hue2rgb(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}
  let q2 = l < 0.5 ? l*(1+s) : l+s-l*s;
  let p2 = 2*l-q2;
  let ro = Math.round(hue2rgb(p2,q2,h+1/3)*255);
  let go2 = Math.round(hue2rgb(p2,q2,h)*255);
  let bo = Math.round(hue2rgb(p2,q2,h-1/3)*255);
  return '#'+((1<<24)+(ro<<16)+(go2<<8)+bo).toString(16).slice(1).toUpperCase();
}

function getColor(sym) {
  const el = getEl(sym);
  return OPTS.palette === 'dark' ? brighten(el.color) : el.color;
}

// --- Scene setup ---
const scene = new THREE.Scene();
if (OPTS.bg !== 'transparent') scene.background = new THREE.Color(OPTS.bg);

const aspect = W / H;
let camera;
if (OPTS.camera === 'persp') {
  camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);
} else {
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
}
camera.position.set(0, 0, 20);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dl1 = new THREE.DirectionalLight(0xffffff, 0.8); dl1.position.set(5, 10, 7); scene.add(dl1);
const dl2 = new THREE.DirectionalLight(0xffffff, 0.3); dl2.position.set(-5, -5, 5); scene.add(dl2);

// --- Supercell expansion ---
const lat = structure.lattice;
const [na, nb, nc] = OPTS.supercell;
const species = [], positions = [];
// 16.3 magnetic moments: track per-expanded-atom moment vector parallel to
// species/positions so the arrow renderer below can iterate uniformly. null
// when structure has no magMom field or --magmom is off.
const haveMagMom = OPTS.magmom && Array.isArray(structure.magMom);
const expandedMagMom = haveMagMom ? [] : null;
// 16.2 partial occupancy: same parallel-array trick. Tracking the per-atom
// occupancy lets the partial render block below pick exact opacity per site
// (preserving Mg/Fe 0.7/0.3 mixed-site visualization) and lets the regular
// atom path skip those indices to avoid drawing them twice.
const havePartialOcc = OPTS.partialOccupancy && Array.isArray(structure.occupancy);
const expandedOccupancy = havePartialOcc ? [] : null;
// 16.1 thermal ellipsoids: track per-atom Uᵢⱼ tensor (or null) so the
// ellipsoid block below can iterate without re-mapping expanded → unit-cell
// index. Atoms with non-null U get peeled off the regular sphere path.
const haveAniso = OPTS.ellipsoids && Array.isArray(structure.thermalAniso);
const expandedAniso = haveAniso ? [] : null;

for (let ia = 0; ia < na; ia++) {
  for (let ib = 0; ib < nb; ib++) {
    for (let ic = 0; ic < nc; ic++) {
      const off = [
        ia*lat[0][0]+ib*lat[1][0]+ic*lat[2][0],
        ia*lat[0][1]+ib*lat[1][1]+ic*lat[2][1],
        ia*lat[0][2]+ib*lat[1][2]+ic*lat[2][2],
      ];
      for (let j = 0; j < structure.species.length; j++) {
        species.push(structure.species[j]);
        positions.push([
          structure.positions[j][0]+off[0],
          structure.positions[j][1]+off[1],
          structure.positions[j][2]+off[2],
        ]);
        if (expandedMagMom) expandedMagMom.push(structure.magMom[j]);
        if (expandedOccupancy) expandedOccupancy.push(structure.occupancy[j] != null ? structure.occupancy[j] : 1.0);
        if (expandedAniso) expandedAniso.push(structure.thermalAniso[j] || null);
      }
    }
  }
}

// --- Boundary atoms ---
if (OPTS.boundary && structure.lattice) {
  const invLat = invertMatrix3(lat);
  const tol = 0.02;
  const baseCount = structure.species.length;
  for (let j = 0; j < baseCount; j++) {
    const pos = structure.positions[j];
    const frac = [
      invLat[0][0]*pos[0]+invLat[0][1]*pos[1]+invLat[0][2]*pos[2],
      invLat[1][0]*pos[0]+invLat[1][1]*pos[1]+invLat[1][2]*pos[2],
      invLat[2][0]*pos[0]+invLat[2][1]*pos[1]+invLat[2][2]*pos[2],
    ];
    const wf = frac.map(f => ((f%1)+1)%1);
    const shifts = [];
    for (let axis = 0; axis < 3; axis++) {
      if (wf[axis] < tol) shifts.push(axis);
    }
    if (shifts.length === 0) continue;
    const combos = [];
    for (let mask = 1; mask < (1 << shifts.length); mask++) {
      const combo = [0, 0, 0];
      for (let b = 0; b < shifts.length; b++) {
        if (mask & (1 << b)) combo[shifts[b]] = 1;
      }
      combos.push(combo);
    }
    for (const combo of combos) {
      for (let ia = 0; ia < na; ia++) {
        for (let ib = 0; ib < nb; ib++) {
          for (let ic = 0; ic < nc; ic++) {
            const sf = [wf[0]+ia+combo[0]*na, wf[1]+ib+combo[1]*nb, wf[2]+ic+combo[2]*nc];
            const cp = [
              sf[0]*lat[0][0]+sf[1]*lat[1][0]+sf[2]*lat[2][0],
              sf[0]*lat[0][1]+sf[1]*lat[1][1]+sf[2]*lat[2][1],
              sf[0]*lat[0][2]+sf[1]*lat[1][2]+sf[2]*lat[2][2],
            ];
            species.push(structure.species[j]);
            positions.push(cp);
            if (expandedMagMom) expandedMagMom.push(structure.magMom[j]);
            if (expandedOccupancy) expandedOccupancy.push(structure.occupancy[j] != null ? structure.occupancy[j] : 1.0);
            if (expandedAniso) expandedAniso.push(structure.thermalAniso[j] || null);
          }
        }
      }
    }
  }
}

function invertMatrix3(m) {
  const [a,b,c] = m;
  const det = a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
  const id = 1/det;
  return [
    [(b[1]*c[2]-b[2]*c[1])*id, (a[2]*c[1]-a[1]*c[2])*id, (a[1]*b[2]-a[2]*b[1])*id],
    [(b[2]*c[0]-b[0]*c[2])*id, (a[0]*c[2]-a[2]*c[0])*id, (a[2]*b[0]-a[0]*b[2])*id],
    [(b[0]*c[1]-b[1]*c[0])*id, (a[1]*c[0]-a[0]*c[1])*id, (a[0]*b[1]-a[1]*b[0])*id],
  ];
}

// --- Bounding box & camera fit ---
let minP = [Infinity,Infinity,Infinity], maxP = [-Infinity,-Infinity,-Infinity];
for (const p of positions) {
  for (let k = 0; k < 3; k++) { minP[k] = Math.min(minP[k], p[k]); maxP[k] = Math.max(maxP[k], p[k]); }
}
// Include cell corners
for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) for (let k = 0; k <= nc; k++) {
  const cp = [i*lat[0][0]+j*lat[1][0]+k*lat[2][0], i*lat[0][1]+j*lat[1][1]+k*lat[2][1], i*lat[0][2]+j*lat[1][2]+k*lat[2][2]];
  for (let d=0;d<3;d++){minP[d]=Math.min(minP[d],cp[d]);maxP[d]=Math.max(maxP[d],cp[d]);}
}
const center = [(minP[0]+maxP[0])/2, (minP[1]+maxP[1])/2, (minP[2]+maxP[2])/2];
const size = Math.max(maxP[0]-minP[0], maxP[1]-minP[1], maxP[2]-minP[2]) || 10;
const frustum = size * 1.3;

// --- View direction ---
function setView(dir) {
  const d = frustum * 2;
  camera.position.set(center[0]+dir[0]*d, center[1]+dir[1]*d, center[2]+dir[2]*d);
  camera.lookAt(center[0], center[1], center[2]);
  // Set up vector: prefer Y-up, fall back to Z-up
  const absDir = dir.map(Math.abs);
  if (absDir[1] > 0.9) camera.up.set(0, 0, 1);
  else camera.up.set(0, 1, 0);
}

function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function normalize(v) { const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); return l > 0 ? v.map(x=>x/l) : [0,0,1]; }
function vol3(a,b,c) { return a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]); }

const V = vol3(lat[0], lat[1], lat[2]);
const recipA = cross(lat[1], lat[2]).map(x => x/V);
const recipB = cross(lat[2], lat[0]).map(x => x/V);
const recipC = cross(lat[0], lat[1]).map(x => x/V);

const viewDirs = {
  'a': normalize(lat[0]), 'b': normalize(lat[1]), 'c': normalize(lat[2]),
  'a*': normalize(recipA), 'b*': normalize(recipB), 'c*': normalize(recipC),
  'std': normalize(recipA),
};

if (OPTS.view === 'std') {
  // Standard: c-axis up, view from a*
  const dir = normalize(recipA);
  const d = frustum * 2;
  camera.position.set(center[0]+dir[0]*d, center[1]+dir[1]*d, center[2]+dir[2]*d);
  camera.lookAt(center[0], center[1], center[2]);
  camera.up.set(lat[2][0], lat[2][1], lat[2][2]).normalize();
} else if (viewDirs[OPTS.view]) {
  setView(viewDirs[OPTS.view]);
} else {
  setView([0, 0, 1]);
}

// Apply additional rotation
if (OPTS.rotate[0] || OPTS.rotate[1] || OPTS.rotate[2]) {
  const euler = new THREE.Euler(
    OPTS.rotate[0] * Math.PI / 180,
    OPTS.rotate[1] * Math.PI / 180,
    OPTS.rotate[2] * Math.PI / 180
  );
  const offset = new THREE.Vector3().subVectors(camera.position, new THREE.Vector3(...center));
  offset.applyEuler(euler);
  camera.position.set(center[0]+offset.x, center[1]+offset.y, center[2]+offset.z);
  camera.lookAt(...center);
}

// Ortho frustum
if (OPTS.camera !== 'persp') {
  camera.left = -frustum * aspect / 2;
  camera.right = frustum * aspect / 2;
  camera.top = frustum / 2;
  camera.bottom = -frustum / 2;
  camera.near = -500;
  camera.far = 500;
  camera.updateProjectionMatrix();
}

// --- Render atoms ---
// 16.1 ellipsoid: aniso atoms peeled off first (priority over partial — same
// rule as webview, see src/webview/renderer.ts buildAtoms).
const ellipsoidIdxSet = new Set();
if (expandedAniso) {
  for (let i = 0; i < positions.length; i++) {
    if (expandedAniso[i] != null) ellipsoidIdxSet.add(i);
  }
}
// 16.2 partial occupancy: split off atoms with occupancy<1 from the regular
// per-element grouping so the partial render block (below) handles them
// individually with per-site opacity. Without this filter we'd draw the
// atom twice (opaque + transparent overlapping).
const partialIdxSet = new Set();
if (expandedOccupancy) {
  for (let i = 0; i < positions.length; i++) {
    if (ellipsoidIdxSet.has(i)) continue;
    const occ = expandedOccupancy[i];
    if (occ != null && occ < 1.0 - 1e-6) partialIdxSet.add(i);
  }
}

const elGroups = new Map();
for (let i = 0; i < species.length; i++) {
  if (ellipsoidIdxSet.has(i)) continue;
  if (partialIdxSet.has(i)) continue;
  const s = species[i];
  if (!elGroups.has(s)) elGroups.set(s, []);
  elGroups.get(s).push(i);
}

const N = species.length;
const segs = N < 500 ? [32, 24] : N < 2000 ? [16, 12] : [8, 6];
const sphereGeo = new THREE.SphereGeometry(1, segs[0], segs[1]);

for (const [el, indices] of elGroups) {
  const elData = getEl(el);
  const color = new THREE.Color(getColor(el));
  const mat = new THREE.MeshPhongMaterial({ color });
  const mesh = new THREE.InstancedMesh(sphereGeo, mat, indices.length);

  let r;
  switch (OPTS.style) {
    case 'space-filling': r = elData.vdw; break;
    case 'stick': r = 0.15; break;
    case 'wireframe': r = elData.dr; mat.wireframe = true; break;
    default: r = elData.dr; break;
  }

  const dummy = new THREE.Object3D();
  for (let k = 0; k < indices.length; k++) {
    const idx = indices[k];
    dummy.position.set(positions[idx][0], positions[idx][1], positions[idx][2]);
    dummy.scale.setScalar(r);
    dummy.updateMatrix();
    mesh.setMatrixAt(k, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

// --- 16.4 Wulff polytope (matches src/webview/wulff.ts) ---
// Triple-plane intersection: enumerate every C(n,3) triple, solve 3×3 system,
// keep vertices that satisfy all OTHER planes. Bounding-box fallback ensures
// bounded polytope for under-constrained input. ConvexGeometry triangulates.
if (OPTS.wulff && structure.lattice) {
  const lat = structure.lattice;
  // Reciprocal-lattice basis (no 2π — directions only)
  function det3(a, b, c) {
    return a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
  }
  const Vol = det3(lat[0], lat[1], lat[2]);
  const inv = 1 / Vol;
  const aS = [(lat[1][1]*lat[2][2]-lat[1][2]*lat[2][1])*inv, (lat[1][2]*lat[2][0]-lat[1][0]*lat[2][2])*inv, (lat[1][0]*lat[2][1]-lat[1][1]*lat[2][0])*inv];
  const bS = [(lat[2][1]*lat[0][2]-lat[2][2]*lat[0][1])*inv, (lat[2][2]*lat[0][0]-lat[2][0]*lat[0][2])*inv, (lat[2][0]*lat[0][1]-lat[2][1]*lat[0][0])*inv];
  const cS = [(lat[0][1]*lat[1][2]-lat[0][2]*lat[1][1])*inv, (lat[0][2]*lat[1][0]-lat[0][0]*lat[1][2])*inv, (lat[0][0]*lat[1][1]-lat[0][1]*lat[1][0])*inv];

  const userPlanes = OPTS.wulff.map(p => {
    const n = [p.h*aS[0]+p.k*bS[0]+p.l*cS[0], p.h*aS[1]+p.k*bS[1]+p.l*cS[1], p.h*aS[2]+p.k*bS[2]+p.l*cS[2]];
    const len = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);
    return { normal: [n[0]/len, n[1]/len, n[2]/len], distance: p.gamma };
  });
  const maxD = Math.max(...OPTS.wulff.map(p => p.gamma));
  const half = Math.max(maxD * 4, 5) * 0.5;
  const allPlanes = userPlanes.concat([
    { normal: [1,0,0],  distance: half },
    { normal: [-1,0,0], distance: half },
    { normal: [0,1,0],  distance: half },
    { normal: [0,-1,0], distance: half },
    { normal: [0,0,1],  distance: half },
    { normal: [0,0,-1], distance: half },
  ]);

  function solveTriple(p1, p2, p3) {
    const a = p1.normal, b = p2.normal, c = p3.normal;
    const D = a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
    if (Math.abs(D) < 1e-10) return null;
    const id = 1/D;
    const d1=p1.distance, d2=p2.distance, d3=p3.distance;
    const x = (d1*(b[1]*c[2]-b[2]*c[1]) - a[1]*(d2*c[2]-b[2]*d3) + a[2]*(d2*c[1]-b[1]*d3))*id;
    const y = (a[0]*(d2*c[2]-b[2]*d3) - d1*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*d3-d2*c[0]))*id;
    const z = (a[0]*(b[1]*d3-d2*c[1]) - a[1]*(b[0]*d3-d2*c[0]) + d1*(b[0]*c[1]-b[1]*c[0]))*id;
    return [x, y, z];
  }
  function satisfies(p, planes) {
    for (const pl of planes) {
      const dot = p[0]*pl.normal[0] + p[1]*pl.normal[1] + p[2]*pl.normal[2];
      if (dot > pl.distance + 1e-4) return false;
    }
    return true;
  }
  const verts = [];
  const N = allPlanes.length;
  const TOL2 = 1e-4 * 1e-4;
  for (let i = 0; i < N; i++) for (let j = i+1; j < N; j++) for (let k = j+1; k < N; k++) {
    const v = solveTriple(allPlanes[i], allPlanes[j], allPlanes[k]);
    if (!v) continue;
    if (!satisfies(v, allPlanes)) continue;
    let dup = false;
    for (const u of verts) {
      const dx=u[0]-v[0], dy=u[1]-v[1], dz=u[2]-v[2];
      if (dx*dx+dy*dy+dz*dz < TOL2) { dup = true; break; }
    }
    if (!dup) verts.push(v);
  }
  if (verts.length >= 4) {
    const points = verts.map(v => new THREE.Vector3(v[0], v[1], v[2]));
    const geo = new ConvexGeometry(points);
    const mat = new THREE.MeshPhongMaterial({
      color: 0x4dabf7, shininess: 60,
      transparent: true, opacity: 0.5,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const edges = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x1971c2 });
    const wire = new THREE.LineSegments(edges, edgeMat);
    scene.add(mesh, wire);
  } else {
    console.warn('Wulff: <4 vertices found — input planes do not bound a region; nothing rendered');
  }
}

// --- 16.1 Thermal ellipsoids (matches src/webview/ellipsoidRenderer.ts) ---
// Per-element InstancedMesh, sphere geometry transformed by per-instance
// 4×4 matrix = T(c) · R · diag(scale·√λ₁, scale·√λ₂, scale·√λ₃) where R is
// the eigenvector frame of Uᵢⱼ and λᵢ its eigenvalues. Phong-only path
// (CLI uses Phong throughout). χ²₃ scales hard-coded.
if (ellipsoidIdxSet.size > 0 && expandedAniso) {
  const CONTOUR_50 = Math.sqrt(2.366);
  const CONTOUR_90 = Math.sqrt(6.251);
  const scale = OPTS.ellipsoidContour === 0.9 ? CONTOUR_90 : CONTOUR_50;

  // Inline 3×3 symmetric Jacobi (matches src/webview/math/symEigen.ts).
  function jacobiSym3(M) {
    const A = [[M[0][0],M[0][1],M[0][2]],[M[1][0],M[1][1],M[1][2]],[M[2][0],M[2][1],M[2][2]]];
    const V = [[1,0,0],[0,1,0],[0,0,1]];
    const TOL = 1e-10;
    for (let sweep = 0; sweep < 50; sweep++) {
      const off = A[0][1]*A[0][1] + A[0][2]*A[0][2] + A[1][2]*A[1][2];
      if (off < TOL) break;
      for (let p = 0; p < 2; p++) {
        for (let q = p + 1; q < 3; q++) {
          const apq = A[p][q];
          if (Math.abs(apq) < TOL) continue;
          const app = A[p][p], aqq = A[q][q];
          let t;
          if (Math.abs(app - aqq) < 1e-30) t = apq >= 0 ? 1 : -1;
          else {
            const theta = (aqq - app) / (2 * apq);
            const sgn = theta >= 0 ? 1 : -1;
            t = sgn / (Math.abs(theta) + Math.sqrt(theta*theta + 1));
          }
          const c = 1 / Math.sqrt(t*t + 1);
          const s = t * c;
          const tau = s / (1 + c);
          A[p][p] = app - t*apq;
          A[q][q] = aqq + t*apq;
          A[p][q] = 0; A[q][p] = 0;
          const r = 3 - p - q;
          const arp = A[r][p], arq = A[r][q];
          A[r][p] = arp - s*(arq + tau*arp); A[p][r] = A[r][p];
          A[r][q] = arq + s*(arp - tau*arq); A[q][r] = A[r][q];
          for (let k = 0; k < 3; k++) {
            const vkp = V[k][p], vkq = V[k][q];
            V[k][p] = vkp - s*(vkq + tau*vkp);
            V[k][q] = vkq + s*(vkp - tau*vkq);
          }
        }
      }
    }
    return {
      values: [A[0][0], A[1][1], A[2][2]],
      vectors: [
        [V[0][0], V[1][0], V[2][0]],
        [V[0][1], V[1][1], V[2][1]],
        [V[0][2], V[1][2], V[2][2]],
      ],
    };
  }

  // Group ellipsoid atoms by element so each element gets one InstancedMesh.
  const ellipsoidGroups = new Map();
  for (const i of ellipsoidIdxSet) {
    const el = species[i];
    if (!ellipsoidGroups.has(el)) ellipsoidGroups.set(el, []);
    ellipsoidGroups.get(el).push(i);
  }

  const ellipsoidGeo = new THREE.SphereGeometry(1, 24, 16);
  for (const [el, indices] of ellipsoidGroups) {
    const color = getColor(el);
    const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(color), shininess: 30 });
    const mesh = new THREE.InstancedMesh(ellipsoidGeo, mat, indices.length);
    const matrix = new THREE.Matrix4();
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const u = expandedAniso[i];
      const Umat = [
        [u.U11, u.U12, u.U13],
        [u.U12, u.U22, u.U23],
        [u.U13, u.U23, u.U33],
      ];
      const eig = jacobiSym3(Umat);
      const r0 = Math.sqrt(Math.max(eig.values[0], 0));
      const r1 = Math.sqrt(Math.max(eig.values[1], 0));
      const r2 = Math.sqrt(Math.max(eig.values[2], 0));
      const v0 = eig.vectors[0], v1 = eig.vectors[1], v2 = eig.vectors[2];
      // Right-handed frame guard
      const det =
        v0[0]*(v1[1]*v2[2]-v1[2]*v2[1]) -
        v0[1]*(v1[0]*v2[2]-v1[2]*v2[0]) +
        v0[2]*(v1[0]*v2[1]-v1[1]*v2[0]);
      const f0 = scale * r0, f1 = scale * r1, f2 = scale * (det < 0 ? -r2 : r2);
      const c = positions[i];
      // Column-major 4×4: [v0*f0; v1*f1; v2*f2; center,1]
      matrix.fromArray([
        v0[0]*f0, v0[1]*f0, v0[2]*f0, 0,
        v1[0]*f1, v1[1]*f1, v1[2]*f1, 0,
        v2[0]*f2, v2[1]*f2, v2[2]*f2, 0,
        c[0],     c[1],     c[2],     1,
      ]);
      mesh.setMatrixAt(k, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}

// --- 16.2 Partial-occupancy atoms (per-site transparent Mesh) ---
// Matches src/webview/renderer.ts buildAtoms partial render block. Per-atom
// THREE.Mesh (NOT InstancedMesh) so each gets its exact opacity. Material
// cached by (color, opacity) so Mg+Fe at same site at same occupancy share.
// depthWrite:false + renderOrder:1 so stacked partial atoms blend correctly
// and render after opaque atoms.
if (partialIdxSet.size > 0 && expandedOccupancy) {
  const partialSphereGeo = new THREE.SphereGeometry(1, 24, 16);
  const matCache = new Map();
  for (const i of partialIdxSet) {
    const el = species[i];
    const elData = getEl(el);
    const color = getColor(el);
    const occ = expandedOccupancy[i];
    let r;
    switch (OPTS.style) {
      case 'space-filling': r = elData.vdw; break;
      case 'stick': r = 0.15; break;
      case 'wireframe': r = elData.dr; break;
      default: r = elData.dr; break;
    }
    const matKey = color + '_' + occ.toFixed(3);
    let mat = matCache.get(matKey);
    if (!mat) {
      mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(color),
        shininess: 80,
        transparent: true,
        opacity: occ,
        depthWrite: false,
      });
      matCache.set(matKey, mat);
    }
    const mesh = new THREE.Mesh(partialSphereGeo, mat);
    mesh.position.set(positions[i][0], positions[i][1], positions[i][2]);
    mesh.scale.setScalar(r);
    mesh.renderOrder = 1;
    scene.add(mesh);
  }
}

// --- 16.3 Magnetic moment arrows (matches src/webview/magneticArrowRenderer.ts) ---
if (expandedMagMom) {
  const SHAFT_RADIUS = 0.06, TIP_RADIUS = 0.18, TIP_LENGTH = 0.35, ZERO_THRESHOLD = 1e-4;
  const SCALE = OPTS.magmomScale;
  // Filter zero moments
  const live = [];
  let maxMag = 0;
  for (let i = 0; i < positions.length; i++) {
    const m = expandedMagMom[i];
    if (!m) continue;
    const len = Math.sqrt(m[0]*m[0]+m[1]*m[1]+m[2]*m[2]);
    if (len < ZERO_THRESHOLD) continue;
    if (len > maxMag) maxMag = len;
    live.push({ pos: positions[i], moment: m, mag: len });
  }
  if (live.length > 0) {
    if (maxMag < ZERO_THRESHOLD) maxMag = 1;
    // Colormap: same formulas as src/webview/magneticArrowRenderer.ts
    function interpStops(t, stops) {
      if (t <= 0) return stops[0];
      if (t >= 1) return stops[stops.length - 1];
      const seg = t * (stops.length - 1);
      const i = Math.floor(seg), f = seg - i;
      const a = stops[i], b = stops[i+1];
      return [a[0]+f*(b[0]-a[0]), a[1]+f*(b[1]-a[1]), a[2]+f*(b[2]-a[2])];
    }
    const VIRIDIS = [
      [0.267, 0.005, 0.329],
      [0.231, 0.322, 0.545],
      [0.129, 0.569, 0.549],
      [0.992, 0.906, 0.144],
    ];
    function colormap(moment, mag) {
      const t = mag / maxMag;
      if (OPTS.magmomColormap === 'viridis') return interpStops(t, VIRIDIS);
      // redblue diverging by sign(mz)
      if (moment[2] >= 0) return [1.0, 1.0 - t, 1.0 - t];
      return [1.0 - t, 1.0 - t, 1.0];
    }
    const shaftGeo = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, 1, 12, 1, false);
    const tipGeo = new THREE.ConeGeometry(TIP_RADIUS, TIP_LENGTH, 16);
    // base = white so instanceColor multiplies through (no vertexColors:true —
    // see fix(v0.16.3) commit 0c23a2c for why that flag would zero the diffuse)
    const shaftMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30 });
    const tipMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30 });
    const shaftMesh = new THREE.InstancedMesh(shaftGeo, shaftMat, live.length);
    const tipMesh = new THREE.InstancedMesh(tipGeo, tipMat, live.length);
    shaftMesh.frustumCulled = true;
    tipMesh.frustumCulled = true;

    const yAxis = new THREE.Vector3(0, 1, 0);
    const dirV = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const sm = new THREE.Matrix4();
    const tm = new THREE.Matrix4();
    const tmpColor = new THREE.Color();
    for (let i = 0; i < live.length; i++) {
      const inst = live[i];
      const len = inst.mag * SCALE;
      dirV.set(inst.moment[0], inst.moment[1], inst.moment[2]).normalize();
      quat.setFromUnitVectors(yAxis, dirV);
      // Shaft: midpoint, scale Y to len
      sm.compose(
        new THREE.Vector3(inst.pos[0]+0.5*len*dirV.x, inst.pos[1]+0.5*len*dirV.y, inst.pos[2]+0.5*len*dirV.z),
        quat,
        new THREE.Vector3(1, len, 1)
      );
      shaftMesh.setMatrixAt(i, sm);
      // Tip: end of shaft, default scale
      tm.compose(
        new THREE.Vector3(inst.pos[0]+len*dirV.x, inst.pos[1]+len*dirV.y, inst.pos[2]+len*dirV.z),
        quat,
        new THREE.Vector3(1, 1, 1)
      );
      tipMesh.setMatrixAt(i, tm);
      const c = colormap(inst.moment, inst.mag);
      tmpColor.setRGB(c[0], c[1], c[2]);
      shaftMesh.setColorAt(i, tmpColor);
      tipMesh.setColorAt(i, tmpColor);
    }
    shaftMesh.instanceMatrix.needsUpdate = true;
    tipMesh.instanceMatrix.needsUpdate = true;
    if (shaftMesh.instanceColor) shaftMesh.instanceColor.needsUpdate = true;
    if (tipMesh.instanceColor) tipMesh.instanceColor.needsUpdate = true;
    shaftMesh.computeBoundingSphere();
    tipMesh.computeBoundingSphere();
    scene.add(shaftMesh, tipMesh);
  }
}

// --- 17.4.1 Multi-phase overlay (matches src/webview/renderer.ts rebuildSecondaryPhases) ---
// Each --phase file is rendered as transparent Phong atoms with default
// offset (0,0,0) and opacity 0.5. depthWrite:false + renderOrder:1 so the
// blend reads correctly over opaque primary atoms. No bonds / boundary for
// secondary phases (visual clutter avoidance — same policy as webview).
if (phases.length > 0) {
  const PHASE_OPACITY = 0.5;
  const PHASE_OFFSET = [0, 0, 0];
  const phaseSphereGeo = new THREE.SphereGeometry(1, 16, 12);
  for (const phase of phases) {
    const groups = new Map();
    for (let i = 0; i < phase.species.length; i++) {
      const s = phase.species[i];
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s).push(i);
    }
    for (const [el, indices] of groups) {
      const elData = getEl(el);
      const color = getColor(el);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(color),
        shininess: 30,
        transparent: true,
        opacity: PHASE_OPACITY,
        depthWrite: false,
      });
      const mesh = new THREE.InstancedMesh(phaseSphereGeo, mat, indices.length);
      const dummy = new THREE.Object3D();
      const r = elData.dr;
      for (let k = 0; k < indices.length; k++) {
        const idx = indices[k];
        const p = phase.positions[idx];
        dummy.position.set(p[0] + PHASE_OFFSET[0], p[1] + PHASE_OFFSET[1], p[2] + PHASE_OFFSET[2]);
        dummy.scale.setScalar(r);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.renderOrder = 1;
      scene.add(mesh);
    }
  }
}

// --- 17.4.2 Comparison: NN displacement arrows + RMSD stats ---
// Mirrors src/webview/{nnMatching,displacementArrowRenderer,renderer}.ts.
// PBC-aware when primary/secondary lattices match element-wise. Stats are
// stashed on window.__comparisonStats for Node-side stdout extraction.
if (compareToPhase && phases.length > 0) {
  const ZERO_THRESHOLD = 0.05;        // Å — arrows below this are skipped
  const SCALE = 1.0;                   // arrow Å per Å of displacement
  const VIRIDIS = [
    [0.267, 0.005, 0.329],
    [0.231, 0.322, 0.545],
    [0.129, 0.569, 0.549],
    [0.992, 0.906, 0.144],
  ];
  function interpStops(t, stops) {
    if (t <= 0) return stops[0];
    if (t >= 1) return stops[stops.length - 1];
    const seg = t * (stops.length - 1);
    const i = Math.floor(seg), f = seg - i;
    const a = stops[i], b = stops[i+1];
    return [a[0]+f*(b[0]-a[0]), a[1]+f*(b[1]-a[1]), a[2]+f*(b[2]-a[2])];
  }
  // Element-wise lattice equality: cell-mismatched comparison falls back to
  // raw cartesian (minimum-image is ill-defined when cells differ).
  function latticesEqual(a, b) {
    if (!a || !b) return false;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        if (Math.abs(a[r][c] - b[r][c]) > 1e-9) return false;
    return true;
  }
  function applyMinimumImage(dx, dy, dz, lat) {
    const a = lat[0], b = lat[1], c = lat[2];
    const det = a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
    if (Math.abs(det) < 1e-10) return [dx, dy, dz];
    const inv = 1 / det;
    let fx = ((b[1]*c[2]-b[2]*c[1])*dx + (b[2]*c[0]-b[0]*c[2])*dy + (b[0]*c[1]-b[1]*c[0])*dz) * inv;
    let fy = ((a[2]*c[1]-a[1]*c[2])*dx + (a[0]*c[2]-a[2]*c[0])*dy + (a[1]*c[0]-a[0]*c[1])*dz) * inv;
    let fz = ((a[1]*b[2]-a[2]*b[1])*dx + (a[2]*b[0]-a[0]*b[2])*dy + (a[0]*b[1]-a[1]*b[0])*dz) * inv;
    fx -= Math.round(fx); fy -= Math.round(fy); fz -= Math.round(fz);
    return [
      fx*a[0] + fy*b[0] + fz*c[0],
      fx*a[1] + fy*b[1] + fz*c[1],
      fx*a[2] + fy*b[2] + fz*c[2],
    ];
  }
  // NN matching, greedy by species
  const sec = phases[0];
  const usePBC = latticesEqual(structure.lattice, sec.lattice);
  const lat = sec.lattice;
  const secBySpecies = new Map();
  for (let i = 0; i < sec.species.length; i++) {
    const s = sec.species[i];
    if (!secBySpecies.has(s)) secBySpecies.set(s, []);
    secBySpecies.get(s).push(i);
  }
  const usedSecondary = new Set();
  const pairs = [];
  let unmatched = 0;
  const threshold = 2.0;
  const thresholdSq = threshold * threshold;
  for (let a = 0; a < structure.species.length; a++) {
    const cands = secBySpecies.get(structure.species[a]);
    if (!cands) { unmatched++; continue; }
    let bestIdx = -1, bestSq = thresholdSq, bestD = [0,0,0];
    for (const b of cands) {
      if (usedSecondary.has(b)) continue;
      let dx = sec.positions[b][0] - structure.positions[a][0];
      let dy = sec.positions[b][1] - structure.positions[a][1];
      let dz = sec.positions[b][2] - structure.positions[a][2];
      if (usePBC) {
        const w = applyMinimumImage(dx, dy, dz, lat);
        dx = w[0]; dy = w[1]; dz = w[2];
      }
      const dsq = dx*dx + dy*dy + dz*dz;
      if (dsq < bestSq) { bestSq = dsq; bestIdx = b; bestD = [dx, dy, dz]; }
    }
    if (bestIdx === -1) { unmatched++; continue; }
    usedSecondary.add(bestIdx);
    pairs.push({ a, b: bestIdx, d: bestD });
  }
  // Stats
  let sum2 = 0, sum = 0, max = 0;
  const mags = [];
  for (const p of pairs) {
    const m2 = p.d[0]*p.d[0] + p.d[1]*p.d[1] + p.d[2]*p.d[2];
    const m = Math.sqrt(m2);
    sum2 += m2; sum += m; if (m > max) max = m;
    mags.push(m);
  }
  mags.sort((x, y) => x - y);
  const p95 = mags.length > 0 ? mags[Math.min(mags.length - 1, Math.floor(0.95 * mags.length))] : 0;
  window.__comparisonStats = {
    rmsd: pairs.length > 0 ? Math.sqrt(sum2 / pairs.length) : 0,
    maxDisplacement: max,
    meanDisplacement: pairs.length > 0 ? sum / pairs.length : 0,
    p95Displacement: p95,
    matchedCount: pairs.length,
    unmatchedCount: unmatched,
  };
  // Arrow render — viridis colormap, cone+cylinder InstancedMesh
  const live = pairs.filter(p => Math.sqrt(p.d[0]*p.d[0]+p.d[1]*p.d[1]+p.d[2]*p.d[2]) >= ZERO_THRESHOLD);
  if (live.length > 0) {
    const maxMag = Math.max(...live.map(p => Math.sqrt(p.d[0]*p.d[0]+p.d[1]*p.d[1]+p.d[2]*p.d[2])), 1e-6);
    const shaftGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 12, 1, false);
    const tipGeo = new THREE.ConeGeometry(0.14, 0.30, 16);
    const shaftMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30 });
    const tipMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30 });
    const shaftMesh = new THREE.InstancedMesh(shaftGeo, shaftMat, live.length);
    const tipMesh = new THREE.InstancedMesh(tipGeo, tipMat, live.length);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const sm = new THREE.Matrix4();
    const tm = new THREE.Matrix4();
    const tmpC = new THREE.Color();
    for (let i = 0; i < live.length; i++) {
      const inst = live[i];
      const mag = Math.sqrt(inst.d[0]*inst.d[0]+inst.d[1]*inst.d[1]+inst.d[2]*inst.d[2]);
      const len = mag * SCALE;
      dir.set(inst.d[0], inst.d[1], inst.d[2]).normalize();
      quat.setFromUnitVectors(yAxis, dir);
      const pos = structure.positions[inst.a];
      sm.compose(
        new THREE.Vector3(pos[0]+0.5*len*dir.x, pos[1]+0.5*len*dir.y, pos[2]+0.5*len*dir.z),
        quat,
        new THREE.Vector3(1, len, 1)
      );
      shaftMesh.setMatrixAt(i, sm);
      tm.compose(
        new THREE.Vector3(pos[0]+len*dir.x, pos[1]+len*dir.y, pos[2]+len*dir.z),
        quat,
        new THREE.Vector3(1, 1, 1)
      );
      tipMesh.setMatrixAt(i, tm);
      const c = interpStops(mag / maxMag, VIRIDIS);
      tmpC.setRGB(c[0], c[1], c[2]);
      shaftMesh.setColorAt(i, tmpC);
      tipMesh.setColorAt(i, tmpC);
    }
    shaftMesh.instanceMatrix.needsUpdate = true;
    tipMesh.instanceMatrix.needsUpdate = true;
    if (shaftMesh.instanceColor) shaftMesh.instanceColor.needsUpdate = true;
    if (tipMesh.instanceColor) tipMesh.instanceColor.needsUpdate = true;
    scene.add(shaftMesh, tipMesh);
  }
}

// --- Detect bonds (always — needed for polyhedra even when bonds hidden) ---
const bondParams = new Map();
const uniqueEls = [...new Set(species)].sort();
for (let i = 0; i < uniqueEls.length; i++) {
  for (let j = i; j < uniqueEls.length; j++) {
    const pair = uniqueEls[i] + '-' + uniqueEls[j];
    const rA = getEl(uniqueEls[i]).cr;
    const rB = getEl(uniqueEls[j]).cr;
    bondParams.set(pair, { min: 0.1, max: rA + rB + 0.3 });
  }
}

const bonds = [];
{
  // Simple O(N^2) for CLI (structures are typically small)
  const maxCut = Math.max(...[...bondParams.values()].map(p => p.max));
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[j][0]-positions[i][0];
      const dy = positions[j][1]-positions[i][1];
      const dz = positions[j][2]-positions[i][2];
      const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
      if (dist > maxCut || dist < 0.1) continue;
      const pair = [species[i], species[j]].sort().join('-');
      const params = bondParams.get(pair);
      if (params && dist >= params.min && dist <= params.max) {
        bonds.push({ i, j, dist });
      }
    }
  }
}

// --- Render bond cylinders ---
if (OPTS.bonds && OPTS.style !== 'space-filling') {
  const cylGeo = new THREE.CylinderGeometry(0.08, 0.08, 1, 8);
  cylGeo.translate(0, 0.5, 0);
  cylGeo.rotateX(Math.PI / 2);

  for (const bond of bonds) {
    const pA = new THREE.Vector3(...positions[bond.i]);
    const pB = new THREE.Vector3(...positions[bond.j]);
    const mid = new THREE.Vector3().lerpVectors(pA, pB, 0.5);
    const dir = new THREE.Vector3().subVectors(pB, pA);
    const halfLen = dir.length() / 2;

    const matA = new THREE.MeshPhongMaterial({ color: new THREE.Color(getColor(species[bond.i])) });
    const meshA = new THREE.Mesh(cylGeo, matA);
    meshA.position.copy(pA);
    meshA.scale.set(1, 1, halfLen);
    meshA.lookAt(mid);
    scene.add(meshA);

    const matB = new THREE.MeshPhongMaterial({ color: new THREE.Color(getColor(species[bond.j])) });
    const meshB = new THREE.Mesh(cylGeo, matB);
    meshB.position.copy(pB);
    meshB.scale.set(1, 1, halfLen);
    meshB.lookAt(mid);
    scene.add(meshB);
  }
}

// --- Cell wireframe ---
if (OPTS.cell && structure.lattice) {
  const cellVerts = [];
  const a = lat[0], b = lat[1], c = lat[2];
  const corners = [
    [0,0,0],[1,0,0],[1,1,0],[0,1,0],
    [0,0,1],[1,0,1],[1,1,1],[0,1,1],
  ].map(([i,j,k]) => [
    i*na*a[0]+j*nb*b[0]+k*nc*c[0],
    i*na*a[1]+j*nb*b[1]+k*nc*c[1],
    i*na*a[2]+j*nb*b[2]+k*nc*c[2],
  ]);
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  for (const [i,j] of edges) {
    cellVerts.push(...corners[i], ...corners[j]);
  }
  const cellGeo = new THREE.BufferGeometry();
  cellGeo.setAttribute('position', new THREE.Float32BufferAttribute(cellVerts, 3));
  const cellColor = OPTS.palette === 'dark' ? 0x888888 : 0x444444;
  const cellMat = new THREE.LineBasicMaterial({ color: cellColor });
  scene.add(new THREE.LineSegments(cellGeo, cellMat));
}

// --- Labels (sprite-based) ---
if (OPTS.labels) {
  const labelTextureCache = new Map();
  function makeLabelTex(element) {
    if (labelTextureCache.has(element)) return labelTextureCache.get(element);
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, 128, 64, 8);
    else ctx.rect(0, 0, 128, 64);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(element, 64, 32);
    const tex = new THREE.CanvasTexture(c);
    labelTextureCache.set(element, tex);
    return tex;
  }
  for (let i = 0; i < species.length; i++) {
    const tex = makeLabelTex(species[i]);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const p = positions[i];
    sprite.position.set(p[0], p[1] + 0.5, p[2]);
    sprite.scale.set(0.8, 0.4, 1);
    scene.add(sprite);
  }
}

// --- Coordination polyhedra ---
if (OPTS.polyhedra && bonds.length > 0) {
  const adjD = new Map(); // atomIdx → [{idx, dist}]
  for (const bond of bonds) {
    if (!adjD.has(bond.i)) adjD.set(bond.i, []);
    if (!adjD.has(bond.j)) adjD.set(bond.j, []);
    adjD.get(bond.i).push({ idx: bond.j, dist: bond.dist });
    adjD.get(bond.j).push({ idx: bond.i, dist: bond.dist });
  }
  const TOL = 1.2;

  // Resolve centers: explicit list from --polyhedra-centers, else auto-detect
  // via first-coordination-shell (see matching comment in webview renderer).
  let centerSet;
  if (OPTS.polyhedraCenters && OPTS.polyhedraCenters.length > 0) {
    centerSet = new Set(OPTS.polyhedraCenters);
  } else {
    const atomsByEl = new Map();
    for (const atomIdx of adjD.keys()) {
      const el = species[atomIdx];
      if (!atomsByEl.has(el)) atomsByEl.set(el, []);
      atomsByEl.get(el).push(atomIdx);
    }
    centerSet = new Set();
    for (const [el, idxs] of atomsByEl) {
      let maxCoord = 0;
      const ligandTotals = new Map();
      let total = 0;
      for (const atomIdx of idxs) {
        const nbrs = adjD.get(atomIdx);
        if (!nbrs || nbrs.length === 0) continue;
        // Compute the nearest *heteroatomic* neighbor distance; this keeps
        // boundary atoms that only see same-element images from polluting
        // the ligand tally (e.g. rutile Ti at the corner with Ti-Ti at
        // 2.96 Å but no O in range).
        let minDist = Infinity;
        for (const n of nbrs) if (species[n.idx] !== el && n.dist < minDist) minDist = n.dist;
        if (!isFinite(minDist)) continue;
        const cut = minDist * TOL;
        let shellCount = 0;
        for (const n of nbrs) {
          if (n.dist > cut) continue;
          const nEl = species[n.idx];
          ligandTotals.set(nEl, (ligandTotals.get(nEl) || 0) + 1);
          total++;
          shellCount++;
        }
        if (shellCount > maxCoord) maxCoord = shellCount;
      }
      if (maxCoord < 4 || maxCoord > 8) continue;
      if (total === 0) continue;
      let domEl = '', domC = 0;
      for (const [e, c] of ligandTotals) if (c > domC) { domC = c; domEl = e; }
      if (domEl === el) continue;
      if (domC / total >= 0.85) centerSet.add(el);
    }
  }

  for (const [center, nbrList] of adjD) {
    const el = species[center];
    if (!centerSet.has(el)) continue;
    if (!nbrList || nbrList.length === 0) continue;
    let minDist = Infinity;
    for (const n of nbrList) if (species[n.idx] !== el && n.dist < minDist) minDist = n.dist;
    if (!isFinite(minDist)) continue;
    const cut = minDist * TOL;
    const shell = nbrList.filter(n => n.dist <= cut && species[n.idx] !== el);
    if (shell.length < 4) continue;
    const verts = shell.map(n => new THREE.Vector3(...positions[n.idx]));

    let geo;
    try {
      geo = new ConvexGeometry(verts);
    } catch {
      continue;
    }
    const posAttr = geo.getAttribute('position');
    if (!posAttr || posAttr.count < 3) { geo.dispose(); continue; }

    const color = new THREE.Color(getColor(species[center]));
    const mat = new THREE.MeshPhongMaterial({
      color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, shininess: 30,
    });
    scene.add(new THREE.Mesh(geo, mat));
    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesMat = new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.6) });
    scene.add(new THREE.LineSegments(edgesGeo, edgesMat));
  }
}

// --- Isosurface (volumetric data) ---
if (volumetric && OPTS.iso !== null && OPTS.iso > 0) {
  const baseData = new Float32Array(volumetric.data);
  const vorigin = volumetric.origin;
  const vlat = volumetric.lattice;
  const level = OPTS.iso;

  const tiled = tileVolumetricPBC(baseData, volumetric.dims, OPTS.supercell);
  const scLat = [
    [vlat[0][0] * na, vlat[0][1] * na, vlat[0][2] * na],
    [vlat[1][0] * nb, vlat[1][1] * nb, vlat[1][2] * nb],
    [vlat[2][0] * nc, vlat[2][1] * nc, vlat[2][2] * nc],
  ];
  const [Nx, Ny, Nz] = tiled.dims;
  const uStepA = [scLat[0][0] / Nx, scLat[0][1] / Nx, scLat[0][2] / Nx];
  const vStepB = [scLat[1][0] / Ny, scLat[1][1] / Ny, scLat[1][2] / Ny];
  const wStepC = [scLat[2][0] / Nz, scLat[2][1] / Nz, scLat[2][2] / Nz];
  const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const norm3 = v => { const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
  const nAB = norm3(cross3(scLat[0], scLat[1]));
  const nBC = norm3(cross3(scLat[1], scLat[2]));
  const nCA = norm3(cross3(scLat[2], scLat[0]));

  const sliceAxis = (fixedAxis, fixedIdx) => {
    if (fixedAxis === 0) {
      const out = new Float32Array(Ny * Nz);
      for (let iy = 0; iy < Ny; iy++) for (let iz = 0; iz < Nz; iz++) out[iy * Nz + iz] = tiled.data[fixedIdx * Ny * Nz + iy * Nz + iz];
      return out;
    } else if (fixedAxis === 1) {
      const out = new Float32Array(Nx * Nz);
      for (let ix = 0; ix < Nx; ix++) for (let iz = 0; iz < Nz; iz++) out[ix * Nz + iz] = tiled.data[ix * Ny * Nz + fixedIdx * Nz + iz];
      return out;
    } else {
      const out = new Float32Array(Nx * Ny);
      for (let ix = 0; ix < Nx; ix++) for (let iy = 0; iy < Ny; iy++) out[ix * Ny + iy] = tiled.data[ix * Ny * Nz + iy * Nz + fixedIdx];
      return out;
    }
  };

  const buildLobe = (isoLevel, color, fillBelow) => {
    const mat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(color),
      transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    });

    const mc = marchingCubes(tiled.data, tiled.dims, vorigin, scLat, isoLevel, true);
    if (mc.positions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(mc.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(mc.normals, 3));
      scene.add(new THREE.Mesh(geo, mat));
    }

    const faces = [
      { data: sliceAxis(0, 0), dims: [Ny, Nz], origin: vorigin, u: vStepB, v: wStepC, n: [-nBC[0], -nBC[1], -nBC[2]] },
      { data: sliceAxis(0, 0), dims: [Ny, Nz], origin: [vorigin[0]+scLat[0][0], vorigin[1]+scLat[0][1], vorigin[2]+scLat[0][2]], u: vStepB, v: wStepC, n: nBC },
      { data: sliceAxis(1, 0), dims: [Nx, Nz], origin: vorigin, u: uStepA, v: wStepC, n: [-nCA[0], -nCA[1], -nCA[2]] },
      { data: sliceAxis(1, 0), dims: [Nx, Nz], origin: [vorigin[0]+scLat[1][0], vorigin[1]+scLat[1][1], vorigin[2]+scLat[1][2]], u: uStepA, v: wStepC, n: nCA },
      { data: sliceAxis(2, 0), dims: [Nx, Ny], origin: vorigin, u: uStepA, v: vStepB, n: [-nAB[0], -nAB[1], -nAB[2]] },
      { data: sliceAxis(2, 0), dims: [Nx, Ny], origin: [vorigin[0]+scLat[2][0], vorigin[1]+scLat[2][1], vorigin[2]+scLat[2][2]], u: uStepA, v: vStepB, n: nAB },
    ];
    for (const f of faces) {
      const cap = marchingSquaresFill(f.data, f.dims, f.origin, f.u, f.v, isoLevel, f.n, fillBelow);
      if (cap.positions.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(cap.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(cap.normals, 3));
      scene.add(new THREE.Mesh(geo, mat));
    }
  };

  buildLobe(level, OPTS.palette === 'dark' ? '#4488ff' : '#0044cc', false);
  buildLobe(-level, OPTS.palette === 'dark' ? '#ff4444' : '#cc0000', true);
}

// --- Lattice plane (Miller indices) ---
if (OPTS.plane) {
  const [h, k, l] = OPTS.plane;
  // Plane normal in Cartesian via reciprocal lattice
  const normal = [
    h*recipA[0] + k*recipB[0] + l*recipC[0],
    h*recipA[1] + k*recipB[1] + l*recipC[1],
    h*recipA[2] + k*recipB[2] + l*recipC[2],
  ];
  const nLen = Math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2);
  const nN = normal.map(x => x / nLen);
  const planeGeo = new THREE.PlaneGeometry(size * 1.5, size * 1.5);
  const planeMat = new THREE.MeshPhongMaterial({
    color: 0xffaa00, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
  });
  const planeMesh = new THREE.Mesh(planeGeo, planeMat);
  planeMesh.position.set(...center);
  // Orient plane normal to nN
  const up = new THREE.Vector3(0, 0, 1);
  const target = new THREE.Vector3(...nN);
  planeMesh.quaternion.setFromUnitVectors(up, target);
  scene.add(planeMesh);
}

// --- Fog ---
if (OPTS.bg !== 'transparent') {
  const fogColor = new THREE.Color(OPTS.bg);
  scene.fog = new THREE.FogExp2(fogColor, 0.015);
}

// --- Render ---
renderer.render(scene, camera);
window.__renderDone = true;
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

async function render(opts: RenderOptions) {
  // 17.4.2 pre-flight: --compare-to-phase requires --phase, and is incompatible
  // with --all-frames in v0.17.4 (per-frame comparison deferred).
  if (opts.compareToPhase && opts.phases.length === 0) {
    console.error('Error: --compare-to-phase requires at least one --phase <file>');
    process.exit(1);
  }
  if (opts.compareToPhase && opts.allFrames) {
    console.error('Error: --compare-to-phase + --all-frames not supported in v0.17.4');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--allow-file-access-from-files',
      `--window-size=${opts.width},${opts.height}`,
    ],
  });

  const tmpHtml = path.join(__dirname, '_render_tmp.html');
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: opts.width, height: opts.height });

    page.on('pageerror', err => console.error('Render page error:', err.message));

    let html: string;

    const threePath = path.resolve(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.js');
    const helpersPath = path.resolve(__dirname, 'render-helpers.js');

    // Helper: write tmpHtml + goto + extract canvas + save PNG. Reused for
    // both single-frame and --all-frames paths so the browser/page is reused
    // across iterations (saves ~2s per frame vs per-invocation launch).
    const renderHtmlToPng = async (rawHtml: string, outputPath: string) => {
      const fixed = rawHtml
        .replace(/__THREE_PATH__/g, `file://${threePath}`)
        .replace(/__HELPERS_PATH__/g, `file://${helpersPath}`);
      fs.writeFileSync(tmpHtml, fixed);
      await page.goto(`file://${tmpHtml}`, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForFunction('window.__renderDone === true', { timeout: 30000 });
      await new Promise(r => setTimeout(r, 200));
      const dataUrl = await page.evaluate(() => {
        const c = document.getElementById('c') as HTMLCanvasElement;
        return c ? c.toDataURL('image/png') : null;
      });
      if (dataUrl) {
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));
        console.log(`Saved: ${outputPath}`);
        // 17.4.2: extract comparison stats stashed on window by inline HTML.
        if (opts.compareToPhase) {
          const stats = await page.evaluate(() => (window as any).__comparisonStats);
          if (stats) {
            const fmt = (x: number) => x.toFixed(3);
            console.log(
              `[comparison] RMSD: ${fmt(stats.rmsd)} Å ` +
              `(matched ${stats.matchedCount}, unmatched ${stats.unmatchedCount}, ` +
              `max ${fmt(stats.maxDisplacement)} Å, ` +
              `mean ${fmt(stats.meanDisplacement)} Å, ` +
              `p95 ${fmt(stats.p95Displacement)} Å)`
            );
          }
        }
        return true;
      }
      console.error('Error: could not extract canvas data.');
      return false;
    };

    if (opts.test) {
      const ok = await renderHtmlToPng(generateTestHTML(opts), opts.output);
      if (!ok) process.exitCode = 1;
    } else {
      if (!opts.input) {
        console.error('Error: no input file specified.');
        process.exitCode = 1;
        return;
      }

      const content = fs.readFileSync(opts.input, 'utf-8');
      const filename = path.basename(opts.input);
      // v0.17.3.1: trajectory-aware dispatch.
      const trajResult = parseStructureFileTraj(content, filename);
      const traj = trajResult.trajectory;
      const volumetricJSON = trajResult.volumetric ? JSON.stringify({
        origin: trajResult.volumetric.origin,
        lattice: trajResult.volumetric.lattice,
        dims: trajResult.volumetric.dims,
        data: Array.from(trajResult.volumetric.data),
      }) : null;

      // 17.4.1 multi-phase overlay: load + parse each --phase file (single-
      // frame extracted via parseStructureFile). Pass as JSON to inline HTML.
      const phasesData = opts.phases.map(phasePath => {
        const phaseContent = fs.readFileSync(phasePath, 'utf-8');
        const phaseFilename = path.basename(phasePath);
        const phaseParsed = parseStructureFile(phaseContent, phaseFilename);
        return {
          species: phaseParsed.structure.species,
          positions: phaseParsed.structure.positions,
          lattice: phaseParsed.structure.lattice,
        };
      });
      const phasesJSON = JSON.stringify(phasesData);

      // 17.3.2 --all-frames: render every frame as PNG sequence.
      if (opts.allFrames) {
        if (opts.frame !== 0) {
          console.warn(`--frame ${opts.frame} ignored: --all-frames takes precedence`);
        }
        const N = traj.frames.length;
        if (N === 1) {
          // Non-trajectory or single-frame: still emit one indexed file
          // for naming consistency in scripts that always expect _NNNN.
          console.warn(`--all-frames on single-frame input — emitting one file with _0001 suffix`);
        }
        // Width: 4 digits up to 9999, expand to 5 beyond.
        const padWidth = N > 9999 ? 5 : 4;
        let allOk = true;
        for (let i = 0; i < N; i++) {
          const padded = String(i + 1).padStart(padWidth, '0');
          const outPath = opts.output.replace(/\.png$/i, `_${padded}.png`);
          const structureJSON = JSON.stringify(traj.frames[i]);
          const html = generateStructureHTML(opts, structureJSON, volumetricJSON, phasesJSON, opts.compareToPhase);
          const ok = await renderHtmlToPng(html, outPath);
          if (!ok) { allOk = false; break; }
        }
        if (!allOk) process.exitCode = 1;
      } else {
        // Single-frame extraction (existing 17.3.1 path).
        let frameIdx = opts.frame;
        if (traj.frames.length > 1) {
          if (frameIdx < 0 || frameIdx >= traj.frames.length) {
            console.warn(`--frame ${frameIdx} out of range [0..${traj.frames.length - 1}], clamping`);
            frameIdx = Math.max(0, Math.min(frameIdx, traj.frames.length - 1));
          }
        }
        const structureJSON = JSON.stringify(traj.frames[Math.max(0, Math.min(frameIdx, traj.frames.length - 1))]);
        const html = generateStructureHTML(opts, structureJSON, volumetricJSON, phasesJSON, opts.compareToPhase);
        const ok = await renderHtmlToPng(html, opts.output);
        if (!ok) process.exitCode = 1;
      }
    }
  } finally {
    try { fs.unlinkSync(tmpHtml); } catch {}
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv);
render(opts).catch(err => {
  console.error('Render error:', err);
  process.exit(1);
});
