import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { parseStructureFile } from '../src/parsers/index';
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

function generateStructureHTML(opts: RenderOptions, structureJSON: string, volumetricJSON: string | null): string {
  const threeURL = '__THREE_PATH__';
  const helpersURL = '__HELPERS_PATH__';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>* { margin: 0; padding: 0; } body { width: ${opts.width}px; height: ${opts.height}px; overflow: hidden; background: ${opts.bg}; }</style>
</head><body>
<canvas id="c" width="${opts.width}" height="${opts.height}"></canvas>
<script type="module">
import * as THREE from '${threeURL}';
import { marchingCubes, ConvexGeometry } from '${helpersURL}';

const W = ${opts.width}, H = ${opts.height};
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: ${opts.bg === 'transparent'} });
renderer.setSize(W, H, false);
renderer.setPixelRatio(1);

const structure = ${structureJSON};
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
const elGroups = new Map();
for (let i = 0; i < species.length; i++) {
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
if (volumetric && OPTS.iso !== null) {
  const data = new Float32Array(volumetric.data);
  const dims = volumetric.dims;
  const origin = volumetric.origin;
  const vlat = volumetric.lattice;
  const level = OPTS.iso;

  function buildIso(isoLevel, color) {
    const result = marchingCubes(data, dims, origin, vlat, isoLevel);
    if (result.positions.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
    const mat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(color),
      transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    });
    scene.add(new THREE.Mesh(geo, mat));
  }

  // Positive lobe (blue) and negative lobe (red), VESTA convention
  if (level > 0) {
    buildIso(level, OPTS.palette === 'dark' ? '#4488ff' : '#0044cc');
    buildIso(-level, OPTS.palette === 'dark' ? '#ff4444' : '#cc0000');
  }
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

    if (opts.test) {
      html = generateTestHTML(opts);
    } else {
      if (!opts.input) {
        console.error('Error: no input file specified.');
        process.exitCode = 1;
        return;
      }

      const content = fs.readFileSync(opts.input, 'utf-8');
      const filename = path.basename(opts.input);
      const result = parseStructureFile(content, filename);
      const structureJSON = JSON.stringify(result.structure);
      const volumetricJSON = result.volumetric ? JSON.stringify({
        origin: result.volumetric.origin,
        lattice: result.volumetric.lattice,
        dims: result.volumetric.dims,
        data: Array.from(result.volumetric.data),
      }) : null;

      html = generateStructureHTML(opts, structureJSON, volumetricJSON);
    }

    const threePath = path.resolve(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.js');
    const helpersPath = path.resolve(__dirname, 'render-helpers.js');
    html = html.replace(/__THREE_PATH__/g, `file://${threePath}`);
    html = html.replace(/__HELPERS_PATH__/g, `file://${helpersPath}`);
    fs.writeFileSync(tmpHtml, html);
    await page.goto(`file://${tmpHtml}`, { waitUntil: 'networkidle0', timeout: 30000 });

    await page.waitForFunction('window.__renderDone === true', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 200));

    const dataUrl = await page.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      return c ? c.toDataURL('image/png') : null;
    });

    if (dataUrl) {
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(opts.output, Buffer.from(base64, 'base64'));
      console.log(`Saved: ${opts.output}`);
    } else {
      console.error('Error: could not extract canvas data.');
      process.exitCode = 1;
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
