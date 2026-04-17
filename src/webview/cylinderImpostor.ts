import * as THREE from 'three';

/**
 * Billboard-based cylinder (bond) impostor. Each instance draws a quad aligned
 * with the bond axis, oriented to face the camera; the fragment shader performs
 * a ray-cylinder intersection, clamps to the segment, picks the correct half
 * color for bicolor bonds, and writes gl_FragDepth so the cylinder composes
 * correctly against other geometry (atoms, cell wireframe, isosurfaces).
 *
 * The bond endpoints are covered by sphere impostors (or real spheres) — we do
 * NOT render cylinder end-caps here; the fragment shader discards hits outside
 * [0, bondLength] along the axis.
 *
 * Per-instance attributes (vec3 endpoints, radius, two colors):
 *   iPosA, iPosB, iRadius, iColorA, iColorB
 *
 * For unicolor bonds, iColorA == iColorB. No picking (bonds aren't selectable
 * in the current UI).
 */

// GLSL 3.00. Three.js injects cameraPosition/viewMatrix/projectionMatrix into
// the vertex prefix and viewMatrix/cameraPosition into the fragment prefix;
// projectionMatrix is NOT in the fragment prefix, so we declare it explicitly.
const VERT = /* glsl */ `
in vec3 iPosA;
in vec3 iPosB;
in float iRadius;
in vec3 iColorA;
in vec3 iColorB;

out vec3 vPosA;
out vec3 vPosB;
out float vRadius;
out vec3 vColorA;
out vec3 vColorB;
out vec3 vRayView;

void main() {
  vec3 center = 0.5 * (iPosA + iPosB);
  vec3 delta = iPosB - iPosA;
  float bondLen = length(delta);
  vec3 axisN = delta / max(bondLen, 1e-6);

  // Direction from bond center toward camera (world space). For orthographic
  // cameras this varies slightly by bond position; fine as long as the quad
  // envelops the silhouette.
  vec3 toCam = cameraPosition - center;
  float toCamLen = length(toCam);
  vec3 toCamN = toCam / max(toCamLen, 1e-6);

  // Flip axis to point toward camera — keeps billboard orientation consistent.
  float dotAC = dot(axisN, toCamN);
  vec3 ldir = dotAC < 0.0 ? -axisN : axisN;

  // Side direction: perpendicular to axis and view. Falls back to an arbitrary
  // perpendicular when camera looks exactly down the axis.
  vec3 side = cross(toCamN, ldir);
  float sideLen = length(side);
  vec3 sideN;
  if (sideLen < 1e-4) {
    vec3 alt = abs(ldir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    sideN = normalize(cross(ldir, alt));
  } else {
    sideN = side / sideLen;
  }
  // Up (out of quad plane, toward camera). Used to push the quad forward by
  // one radius so it covers the near silhouette when the bond is near-axial.
  vec3 up = normalize(cross(ldir, sideN));

  // position.xy in {-1, +1} marks the 4 quad corners; .x = axial, .y = side.
  float axialExt = 0.5 * bondLen + iRadius;
  vec3 posWorld = center
    + position.x * axialExt * ldir
    + position.y * iRadius * sideN
    + iRadius * up;

  vec4 posView = viewMatrix * vec4(posWorld, 1.0);
  vPosA = (viewMatrix * vec4(iPosA, 1.0)).xyz;
  vPosB = (viewMatrix * vec4(iPosB, 1.0)).xyz;
  vRadius = iRadius;
  vColorA = iColorA;
  vColorB = iColorB;
  vRayView = posView.xyz;

  gl_Position = projectionMatrix * posView;
}
`;

const FRAG = /* glsl */ `
precision highp float;

in vec3 vPosA;
in vec3 vPosB;
in float vRadius;
in vec3 vColorA;
in vec3 vColorB;
in vec3 vRayView;

out vec4 fragColor;

// Apply sRGB encoding to match three.js's built-in material output (which adds
// this via <colorspace_fragment>). Without it the impostor output lands raw in
// an sRGB framebuffer and reads as oversaturated vs Phong cylinders.
vec3 linearToSRGB(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 cutoff = step(vec3(0.0031308), c);
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  vec3 lo = c * 12.92;
  return mix(lo, hi, cutoff);
}

// projectionMatrix is not in the fragment prefix — declare explicitly.
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

  vec3 axis = vPosB - vPosA;
  float bondLen = length(axis);
  if (bondLen < 1e-6) discard;
  vec3 axisN = axis / bondLen;

  // Ray-cylinder intersection: solve |(oa + t*d) - ((oa + t*d)·a) a|^2 = r^2.
  vec3 oa = rayOrigin - vPosA;
  float da = dot(rayDir, axisN);
  float wa = dot(oa, axisN);
  float A = 1.0 - da * da;              // ray is unit-length
  // Discard rays nearly parallel to the axis — the caps are drawn by spheres.
  if (A < 1e-6) discard;
  float B = dot(rayDir, oa) - da * wa;
  float C = dot(oa, oa) - wa * wa - vRadius * vRadius;
  float disc = B * B - A * C;
  if (disc < 0.0) discard;
  float t = (-B - sqrt(disc)) / A;
  if (t < 0.0) discard;

  vec3 hitView = rayOrigin + t * rayDir;
  float axialT = dot(hitView - vPosA, axisN);
  if (axialT < 0.0 || axialT > bondLen) discard;

  // Normal: from the axis to the hit point, perpendicular to the axis.
  vec3 axisPoint = vPosA + axialT * axisN;
  vec3 normalView = normalize(hitView - axisPoint);

  // Bicolor split at midpoint.
  vec3 color = axialT < (0.5 * bondLen) ? vColorA : vColorB;

  // Match three's Phong BRDF: ambient + each directional light both go through
  // BRDF_Lambert = color * RECIPROCAL_PI. Skipping 1/π on ambient left bonds
  // looking vivid/rich; apply it uniformly so they fade to the same pastel.
  const float RECIPROCAL_PI = 0.31830988618;
  vec3 L = normalize(uLightDir);
  vec3 LF = normalize(uLightDirFill);
  float ndotl = max(dot(normalView, L), 0.0);
  float ndotlFill = max(dot(normalView, LF), 0.0);
  vec3 shaded = color * (uAmbient + vec3(ndotl * 0.8 + ndotlFill * 0.3)) * RECIPROCAL_PI;
  if (ndotl > 0.0) {
    vec3 R = reflect(-L, normalView);
    vec3 V = -normalize(hitView);
    float spec = pow(max(dot(R, V), 0.0), uShininess);
    shaded += vec3(1.0) * spec * 0.067;
  }
  fragColor = vec4(linearToSRGB(shaded), 1.0);

  vec4 clip = projectionMatrix * vec4(hitView, 1.0);
  float ndcZ = clip.z / clip.w;
  gl_FragDepth = ndcZ * 0.5 + 0.5;
}
`;

let sharedQuadGeo: THREE.BufferGeometry | null = null;

function getQuadTemplate(): THREE.BufferGeometry {
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

export function createCylinderImpostorMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    glslVersion: THREE.GLSL3,
    uniforms: {
      uLightDir: { value: new THREE.Vector3(5, 10, 7).normalize() },
      uLightDirFill: { value: new THREE.Vector3(-5, -5, -5).normalize() },
      uAmbient: { value: new THREE.Color(0.5, 0.5, 0.5) },
      uShininess: { value: 40.0 },
      uOrtho: { value: true },
    },
  });
}

/**
 * Build an InstancedBufferGeometry with the shared quad + per-instance
 * attribute buffers. Caller fills iPosA/iPosB/iRadius/iColorA/iColorB then
 * marks the attributes `needsUpdate = true` (or uses setInstance + commit
 * on CylinderImpostorMesh).
 */
function createImpostorGeometry(count: number): THREE.InstancedBufferGeometry {
  const template = getQuadTemplate();
  const geom = new THREE.InstancedBufferGeometry();
  geom.setAttribute('position', template.getAttribute('position'));
  geom.setIndex(template.getIndex());

  geom.setAttribute('iPosA', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
  geom.setAttribute('iPosB', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
  geom.setAttribute('iRadius', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  geom.setAttribute('iColorA', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
  geom.setAttribute('iColorB', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
  geom.instanceCount = count;
  return geom;
}

export class CylinderImpostorMesh extends THREE.Mesh {
  private readonly instGeom: THREE.InstancedBufferGeometry;
  private readonly iPosA: THREE.InstancedBufferAttribute;
  private readonly iPosB: THREE.InstancedBufferAttribute;
  private readonly iRadius: THREE.InstancedBufferAttribute;
  private readonly iColorA: THREE.InstancedBufferAttribute;
  private readonly iColorB: THREE.InstancedBufferAttribute;

  constructor(count: number, material: THREE.ShaderMaterial) {
    const geom = createImpostorGeometry(count);
    super(geom, material);
    this.instGeom = geom;
    this.iPosA = geom.getAttribute('iPosA') as THREE.InstancedBufferAttribute;
    this.iPosB = geom.getAttribute('iPosB') as THREE.InstancedBufferAttribute;
    this.iRadius = geom.getAttribute('iRadius') as THREE.InstancedBufferAttribute;
    this.iColorA = geom.getAttribute('iColorA') as THREE.InstancedBufferAttribute;
    this.iColorB = geom.getAttribute('iColorB') as THREE.InstancedBufferAttribute;
    // Quad extends dynamically with the camera; Three's default frustum check
    // would miscull. Bonds are always near atoms, which already drive culling.
    this.frustumCulled = false;
  }

  setInstance(
    i: number,
    a: [number, number, number] | THREE.Vector3,
    b: [number, number, number] | THREE.Vector3,
    radius: number,
    colorA: THREE.Color,
    colorB: THREE.Color,
  ) {
    const ax = Array.isArray(a) ? a[0] : a.x;
    const ay = Array.isArray(a) ? a[1] : a.y;
    const az = Array.isArray(a) ? a[2] : a.z;
    const bx = Array.isArray(b) ? b[0] : b.x;
    const by = Array.isArray(b) ? b[1] : b.y;
    const bz = Array.isArray(b) ? b[2] : b.z;
    this.iPosA.setXYZ(i, ax, ay, az);
    this.iPosB.setXYZ(i, bx, by, bz);
    this.iRadius.setX(i, radius);
    this.iColorA.setXYZ(i, colorA.r, colorA.g, colorA.b);
    this.iColorB.setXYZ(i, colorB.r, colorB.g, colorB.b);
  }

  commit() {
    this.iPosA.needsUpdate = true;
    this.iPosB.needsUpdate = true;
    this.iRadius.needsUpdate = true;
    this.iColorA.needsUpdate = true;
    this.iColorB.needsUpdate = true;
  }

  raycast(): void {
    // Bonds are not pickable.
  }

  dispose() {
    this.instGeom.dispose();
  }
}

export function disposeCylinderImpostorShared() {
  if (sharedQuadGeo) {
    sharedQuadGeo.dispose();
    sharedQuadGeo = null;
  }
}
