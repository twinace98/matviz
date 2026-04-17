import * as THREE from 'three';

/**
 * Billboard-based sphere impostor. Each instance draws a screen-aligned quad;
 * the fragment shader performs a ray-sphere intersection and writes gl_FragDepth
 * so impostor spheres z-compose correctly against real geometry (bonds, cell
 * wireframe, isosurfaces).
 *
 * Per-instance data:
 *   instanceMatrix → translation = world-space center, uniform scale = radius
 *   instanceColor  → per-atom color (also used for selection highlight swap)
 *
 * Picking: a custom raycast() replaces the default InstancedMesh raycast
 * (which would hit the billboard quad, not the sphere surface).
 */
// GLSL 3.00 (WebGL2). ShaderMaterial wraps with #version 300 es when
// glslVersion: THREE.GLSL3. Three.js auto-injects `in vec3 position`,
// `in mat4 instanceMatrix` (USE_INSTANCING), `in vec3 instanceColor`
// (USE_INSTANCING_COLOR), and the standard matrix uniforms — declaring
// them again triggers a duplicate-identifier shader compile error.
const VERT = /* glsl */ `
out vec3 vCenterView;
out float vRadius;
out vec3 vRayView;
out vec3 vColor;

void main() {
  vec4 instCenter = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  // Uniform scale lives in any column's length; use column X.
  vec3 col0 = (instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
  float radius = length(col0);

  vCenterView = (viewMatrix * instCenter).xyz;
  vRadius = radius;
  vColor = instanceColor;

  vec3 posView = vCenterView + vec3(position.xy * radius, 0.0);
  vRayView = posView;
  gl_Position = projectionMatrix * vec4(posView, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

in vec3 vCenterView;
in float vRadius;
in vec3 vRayView;
in vec3 vColor;

out vec4 fragColor;

// sRGB encoding — three.js applies this to built-in materials via
// <colorspace_fragment>, which isn't injected into ShaderMaterial. Without it
// our linear output is rendered raw and the browser displays it as sRGB, which
// reads as oversaturated / high-contrast compared to the Phong path.
vec3 linearToSRGB(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 cutoff = step(vec3(0.0031308), c);
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  vec3 lo = c * 12.92;
  return mix(lo, hi, cutoff);
}

// Three.js auto-injects viewMatrix/cameraPosition/isOrthographic into the
// fragment prefix but NOT projectionMatrix / modelViewMatrix, so we declare
// it here; Three.js sets the uniform at the program level.
uniform mat4 projectionMatrix;
uniform vec3 uLightDir;
uniform vec3 uLightDirFill;
uniform vec3 uAmbient;
uniform float uShininess;
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
  vec3 normalView = normalize(hitView - vCenterView);

  // Match three's Phong pipeline exactly: every diffuse term (ambient +
  // directional lights) passes through BRDF_Lambert = color * RECIPROCAL_PI.
  // Previously we applied 1/π to directional diffuse only, leaving ambient
  // ~π× too bright — which read as "rich/vivid" next to the Phong path.
  const float RECIPROCAL_PI = 0.31830988618;
  vec3 L = normalize(uLightDir);
  vec3 LF = normalize(uLightDirFill);
  float ndotl = max(dot(normalView, L), 0.0);
  float ndotlFill = max(dot(normalView, LF), 0.0);
  vec3 color = vColor * (uAmbient + vec3(ndotl * 0.8 + ndotlFill * 0.3)) * RECIPROCAL_PI;
  if (ndotl > 0.0) {
    vec3 R = reflect(-L, normalView);
    vec3 V = -normalize(hitView);
    float spec = pow(max(dot(R, V), 0.0), uShininess);
    color += vec3(1.0) * spec * 0.067;
  }

  fragColor = vec4(linearToSRGB(color), 1.0);

  vec4 clip = projectionMatrix * vec4(hitView, 1.0);
  float ndcZ = clip.z / clip.w;
  gl_FragDepth = ndcZ * 0.5 + 0.5;
}
`;

let sharedQuadGeo: THREE.BufferGeometry | null = null;

function getQuadGeometry(): THREE.BufferGeometry {
  if (sharedQuadGeo) return sharedQuadGeo;
  const g = new THREE.BufferGeometry();
  const positions = new Float32Array([
    -1, -1, 0,
     1, -1, 0,
     1,  1, 0,
    -1,  1, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  sharedQuadGeo = g;
  return g;
}

export function createImpostorMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    glslVersion: THREE.GLSL3,
    uniforms: {
      uLightDir: { value: new THREE.Vector3(5, 10, 7).normalize() },
      uLightDirFill: { value: new THREE.Vector3(-5, -5, -5).normalize() },
      uAmbient: { value: new THREE.Color(0.5, 0.5, 0.5) },
      uShininess: { value: 80.0 },
      uOrtho: { value: true },
    },
  });
}

export class SphereImpostorMesh extends THREE.InstancedMesh {
  constructor(count: number, material: THREE.ShaderMaterial) {
    super(getQuadGeometry(), material, count);
    // Our billboard geometry is a tiny quad, but instances fan out with their
    // radii — default InstancedMesh bounding sphere would miscull.
    this.frustumCulled = false;
  }

  raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    if (this.count === 0) return;
    const dummy = new THREE.Matrix4();
    const center = new THREE.Vector3();
    const scaleVec = new THREE.Vector3();
    const oc = new THREE.Vector3();
    const ray = raycaster.ray;
    for (let i = 0; i < this.count; i++) {
      this.getMatrixAt(i, dummy);
      center.setFromMatrixPosition(dummy);
      scaleVec.setFromMatrixScale(dummy);
      const radius = scaleVec.x;
      center.applyMatrix4(this.matrixWorld);
      oc.subVectors(ray.origin, center);
      const b = oc.dot(ray.direction);
      const c = oc.dot(oc) - radius * radius;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0) continue;
      if (t < raycaster.near || t > raycaster.far) continue;
      const point = new THREE.Vector3().copy(ray.direction).multiplyScalar(t).add(ray.origin);
      intersects.push({
        distance: t,
        point,
        object: this,
        instanceId: i,
      });
    }
  }
}

export function disposeImpostorShared() {
  if (sharedQuadGeo) {
    sharedQuadGeo.dispose();
    sharedQuadGeo = null;
  }
}
