import * as THREE from 'three';
import { SphereImpostorMesh } from './sphereImpostor';

/**
 * GPU-based atom picking for large structures. Renders a small pick scene into
 * a 1×1 render target (via camera.setViewOffset), reading back a single pixel
 * whose RGB encodes the globally-unique atom index + 1 (so RGB = (0,0,0) is
 * "no hit"). The pick scene mirrors the atom meshes but swaps in a pick shader
 * that outputs the encoded id; sphere impostors keep their ray-sphere test so
 * pick hits lie on the sphere surface, not the billboard quad.
 *
 * For small structures the CPU raycaster is still faster — the renderer picks
 * per-click based on a threshold.
 */

export interface AtomMeshEntry {
  mesh: THREE.InstancedMesh;
  globalIndices: number[];
  baseColor: THREE.Color;
}

const PICK_VERT_IMPOSTOR = /* glsl */ `
in vec3 iPickColor;

out vec3 vCenterView;
out float vRadius;
out vec3 vRayView;
out vec3 vPickColor;

void main() {
  vec4 instCenter = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 col0 = (instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
  float radius = length(col0);
  vCenterView = (viewMatrix * instCenter).xyz;
  vRadius = radius;
  vPickColor = iPickColor;
  vec3 posView = vCenterView + vec3(position.xy * radius, 0.0);
  vRayView = posView;
  gl_Position = projectionMatrix * vec4(posView, 1.0);
}
`;

const PICK_FRAG_IMPOSTOR = /* glsl */ `
precision highp float;

in vec3 vCenterView;
in float vRadius;
in vec3 vRayView;
in vec3 vPickColor;

out vec4 fragColor;

uniform mat4 projectionMatrix;
uniform bool uOrtho;

void main() {
  vec3 rayOrigin;
  vec3 rayDir;
  if (uOrtho) {
    rayOrigin = vec3(vRayView.xy, 0.0);
    rayDir = vec3(0.0, 0.0, -1.0);
  } else {
    rayOrigin = vec3(0.0);
    rayDir = normalize(vRayView);
  }
  vec3 oc = rayOrigin - vCenterView;
  float b = dot(oc, rayDir);
  float c = dot(oc, oc) - vRadius * vRadius;
  float disc = b * b - c;
  if (disc < 0.0) discard;
  float t = -b - sqrt(disc);
  if (t < 0.0) discard;
  vec3 hitView = rayOrigin + t * rayDir;

  fragColor = vec4(vPickColor, 1.0);

  vec4 clip = projectionMatrix * vec4(hitView, 1.0);
  float ndcZ = clip.z / clip.w;
  gl_FragDepth = ndcZ * 0.5 + 0.5;
}
`;

const PICK_VERT_SOLID = /* glsl */ `
in vec3 iPickColor;
out vec3 vPickColor;
void main() {
  vPickColor = iPickColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const PICK_FRAG_SOLID = /* glsl */ `
precision highp float;
in vec3 vPickColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vPickColor, 1.0);
}
`;

function encodeIdIntoRGB(globalIdx: number): [number, number, number] {
  const id = globalIdx + 1; // 0 reserved for background
  return [
    ((id >> 16) & 0xff) / 255,
    ((id >> 8) & 0xff) / 255,
    (id & 0xff) / 255,
  ];
}

function makeImpostorPickMaterial(ortho: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: PICK_VERT_IMPOSTOR,
    fragmentShader: PICK_FRAG_IMPOSTOR,
    glslVersion: THREE.GLSL3,
    uniforms: { uOrtho: { value: ortho } },
  });
}

function makeSolidPickMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: PICK_VERT_SOLID,
    fragmentShader: PICK_FRAG_SOLID,
    glslVersion: THREE.GLSL3,
  });
}

let sharedQuad: THREE.BufferGeometry | null = null;
function getPickQuad(): THREE.BufferGeometry {
  if (sharedQuad) return sharedQuad;
  const g = new THREE.BufferGeometry();
  const positions = new Float32Array([
    -1, -1, 0,
     1, -1, 0,
     1,  1, 0,
    -1,  1, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  sharedQuad = g;
  return g;
}

let sharedSphere: THREE.BufferGeometry | null = null;
function getPickSphere(): THREE.BufferGeometry {
  if (sharedSphere) return sharedSphere;
  // Low-poly is fine for picking — hit bounds are dominated by radius.
  sharedSphere = new THREE.SphereGeometry(1, 12, 8);
  return sharedSphere;
}

export class AtomPickingRenderer {
  private readonly pickScene = new THREE.Scene();
  private readonly target = new THREE.WebGLRenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  private readonly readBuffer = new Uint8Array(4);
  private meshes: THREE.InstancedMesh[] = [];
  private geometries: THREE.InstancedBufferGeometry[] = [];
  private materials: THREE.ShaderMaterial[] = [];

  rebuild(atomMeshMap: AtomMeshEntry[], impostorEnabled: boolean, ortho: boolean): void {
    this.clear();
    for (const entry of atomMeshMap) {
      const count = entry.globalIndices.length;
      if (count === 0) continue;

      const isImpostor = entry.mesh instanceof SphereImpostorMesh;
      const base = isImpostor ? getPickQuad() : getPickSphere();
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', base.getAttribute('position'));
      const idx = base.getIndex();
      if (idx) geo.setIndex(idx);

      const pickAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      for (let i = 0; i < count; i++) {
        const [r, g, b] = encodeIdIntoRGB(entry.globalIndices[i]);
        pickAttr.setXYZ(i, r, g, b);
      }
      geo.setAttribute('iPickColor', pickAttr);
      geo.instanceCount = count;
      this.geometries.push(geo);

      const mat = isImpostor ? makeImpostorPickMaterial(ortho) : makeSolidPickMaterial();
      this.materials.push(mat);

      const mesh = new THREE.InstancedMesh(geo, mat, count);
      // Share instance matrices with the render mesh by reference — picking
      // scene transforms track the render scene automatically. (We still need
      // a per-mesh copy of the instanceMatrix buffer; easiest is to copy once.)
      const m = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        entry.mesh.getMatrixAt(i, m);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = !isImpostor;
      this.meshes.push(mesh);
      this.pickScene.add(mesh);
    }
  }

  setOrtho(ortho: boolean): void {
    for (const mat of this.materials) {
      if (mat.uniforms.uOrtho) mat.uniforms.uOrtho.value = ortho;
    }
  }

  /**
   * Pick the atom under (clientX, clientY) in the given canvas. Returns the
   * global atom index or -1 if no atom was hit.
   */
  pickAt(
    clientX: number,
    clientY: number,
    canvas: HTMLCanvasElement,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    webglRenderer: THREE.WebGLRenderer,
  ): number {
    if (this.meshes.length === 0) return -1;
    const rect = canvas.getBoundingClientRect();
    const pxX = Math.floor((clientX - rect.left) * (canvas.width / rect.width));
    const pxY = Math.floor((clientY - rect.top) * (canvas.height / rect.height));
    if (pxX < 0 || pxY < 0 || pxX >= canvas.width || pxY >= canvas.height) return -1;

    const fullW = canvas.width;
    const fullH = canvas.height;

    // Render only the clicked pixel: setViewOffset shifts the frustum so the
    // 1×1 target sees exactly (pxX, pxY) in canvas space.
    camera.setViewOffset(fullW, fullH, pxX, pxY, 1, 1);
    camera.updateProjectionMatrix();

    const prevTarget = webglRenderer.getRenderTarget();
    const prevClearColor = new THREE.Color();
    webglRenderer.getClearColor(prevClearColor);
    const prevClearAlpha = webglRenderer.getClearAlpha();
    const prevScissorTest = webglRenderer.getScissorTest();

    webglRenderer.setRenderTarget(this.target);
    webglRenderer.setScissorTest(false);
    webglRenderer.setClearColor(0x000000, 0);
    webglRenderer.clear();
    webglRenderer.render(this.pickScene, camera);
    webglRenderer.readRenderTargetPixels(this.target, 0, 0, 1, 1, this.readBuffer);

    // Restore
    webglRenderer.setRenderTarget(prevTarget);
    webglRenderer.setClearColor(prevClearColor, prevClearAlpha);
    webglRenderer.setScissorTest(prevScissorTest);
    camera.clearViewOffset();
    camera.updateProjectionMatrix();

    const id = (this.readBuffer[0] << 16) | (this.readBuffer[1] << 8) | this.readBuffer[2];
    return id === 0 ? -1 : id - 1;
  }

  dispose(): void {
    this.clear();
    this.target.dispose();
  }

  private clear(): void {
    for (const mesh of this.meshes) this.pickScene.remove(mesh);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.meshes = [];
    this.geometries = [];
    this.materials = [];
  }
}

export function disposeAtomPickingShared(): void {
  if (sharedQuad) { sharedQuad.dispose(); sharedQuad = null; }
  if (sharedSphere) { sharedSphere.dispose(); sharedSphere = null; }
}
