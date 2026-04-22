// CPU Marching Cubes implementation for isosurface extraction
// Input: 3D Float32Array grid, lattice vectors, isolevel
// Output: positions and normals as Float32Arrays

import { edgeTable, triTable } from './mcTables';

export interface MarchingCubesResult {
  positions: Float32Array;
  normals: Float32Array;
}

/**
 * Tile a 3D scalar field across `[na, nb, nc]` supercell with periodic
 * wrap (modulo indexing). Output layout matches the input's C order
 * (x outermost, z innermost), consistent with `marchingCubes`.
 */
export function tileVolumetricPBC(
  data: Float32Array,
  dims: [number, number, number],
  supercell: [number, number, number],
): { data: Float32Array; dims: [number, number, number] } {
  const [nx, ny, nz] = dims;
  const [na, nb, nc] = supercell;
  if (na === 1 && nb === 1 && nc === 1) return { data, dims };
  const Nx = nx * na;
  const Ny = ny * nb;
  const Nz = nz * nc;
  const out = new Float32Array(Nx * Ny * Nz);
  for (let ix = 0; ix < Nx; ix++) {
    const sx = ix % nx;
    for (let iy = 0; iy < Ny; iy++) {
      const sy = iy % ny;
      const srcRowStart = sx * ny * nz + sy * nz;
      const dstRowStart = ix * Ny * Nz + iy * Nz;
      for (let ic = 0; ic < nc; ic++) {
        const dstBase = dstRowStart + ic * nz;
        for (let iz = 0; iz < nz; iz++) out[dstBase + iz] = data[srcRowStart + iz];
      }
    }
  }
  return { data: out, dims: [Nx, Ny, Nz] };
}

export function marchingCubes(
  data: Float32Array,
  dims: [number, number, number],
  origin: [number, number, number],
  lattice: [number, number, number][],
  isoLevel: number,
  // When true, treat the grid as periodic: iterate one more cube per axis
  // and wrap the high-index sample via modulo. This makes the iso reach
  // the exact cell boundary instead of stopping one voxel short.
  pbc = false,
): MarchingCubesResult {
  const [nx, ny, nz] = dims;
  const positions: number[] = [];
  const normals: number[] = [];

  // Voxel step vectors
  const dx = [lattice[0][0] / nx, lattice[0][1] / nx, lattice[0][2] / nx];
  const dy = [lattice[1][0] / ny, lattice[1][1] / ny, lattice[1][2] / ny];
  const dz = [lattice[2][0] / nz, lattice[2][1] / nz, lattice[2][2] / nz];

  function getVal(ix: number, iy: number, iz: number): number {
    if (pbc) {
      const ax = ((ix % nx) + nx) % nx;
      const ay = ((iy % ny) + ny) % ny;
      const az = ((iz % nz) + nz) % nz;
      return data[ax * ny * nz + ay * nz + az];
    }
    return data[ix * ny * nz + iy * nz + iz];
  }

  function getPos(ix: number, iy: number, iz: number): [number, number, number] {
    return [
      origin[0] + ix * dx[0] + iy * dy[0] + iz * dz[0],
      origin[1] + ix * dx[1] + iy * dy[1] + iz * dz[1],
      origin[2] + ix * dx[2] + iy * dy[2] + iz * dz[2],
    ];
  }

  function interpolate(
    p1: [number, number, number], p2: [number, number, number],
    v1: number, v2: number
  ): [number, number, number] {
    if (Math.abs(v2 - v1) < 1e-10) {
      return p1;
    }
    const t = (isoLevel - v1) / (v2 - v1);
    return [
      p1[0] + t * (p2[0] - p1[0]),
      p1[1] + t * (p2[1] - p1[1]),
      p1[2] + t * (p2[2] - p1[2]),
    ];
  }

  const endX = pbc ? nx : nx - 1;
  const endY = pbc ? ny : ny - 1;
  const endZ = pbc ? nz : nz - 1;
  for (let ix = 0; ix < endX; ix++) {
    for (let iy = 0; iy < endY; iy++) {
      for (let iz = 0; iz < endZ; iz++) {
        // 8 corner values
        const v = [
          getVal(ix, iy, iz),
          getVal(ix + 1, iy, iz),
          getVal(ix + 1, iy + 1, iz),
          getVal(ix, iy + 1, iz),
          getVal(ix, iy, iz + 1),
          getVal(ix + 1, iy, iz + 1),
          getVal(ix + 1, iy + 1, iz + 1),
          getVal(ix, iy + 1, iz + 1),
        ];

        // Determine cube index
        let cubeIndex = 0;
        for (let i = 0; i < 8; i++) {
          if (v[i] < isoLevel) cubeIndex |= (1 << i);
        }

        if (edgeTable[cubeIndex] === 0) continue;

        // 8 corner positions
        const p = [
          getPos(ix, iy, iz),
          getPos(ix + 1, iy, iz),
          getPos(ix + 1, iy + 1, iz),
          getPos(ix, iy + 1, iz),
          getPos(ix, iy, iz + 1),
          getPos(ix + 1, iy, iz + 1),
          getPos(ix + 1, iy + 1, iz + 1),
          getPos(ix, iy + 1, iz + 1),
        ];

        // Interpolate vertices on edges
        const vertList: [number, number, number][] = new Array(12);
        const edges = edgeTable[cubeIndex];

        if (edges & 1) vertList[0] = interpolate(p[0], p[1], v[0], v[1]);
        if (edges & 2) vertList[1] = interpolate(p[1], p[2], v[1], v[2]);
        if (edges & 4) vertList[2] = interpolate(p[2], p[3], v[2], v[3]);
        if (edges & 8) vertList[3] = interpolate(p[3], p[0], v[3], v[0]);
        if (edges & 16) vertList[4] = interpolate(p[4], p[5], v[4], v[5]);
        if (edges & 32) vertList[5] = interpolate(p[5], p[6], v[5], v[6]);
        if (edges & 64) vertList[6] = interpolate(p[6], p[7], v[6], v[7]);
        if (edges & 128) vertList[7] = interpolate(p[7], p[4], v[7], v[4]);
        if (edges & 256) vertList[8] = interpolate(p[0], p[4], v[0], v[4]);
        if (edges & 512) vertList[9] = interpolate(p[1], p[5], v[1], v[5]);
        if (edges & 1024) vertList[10] = interpolate(p[2], p[6], v[2], v[6]);
        if (edges & 2048) vertList[11] = interpolate(p[3], p[7], v[3], v[7]);

        // Generate triangles
        const tri = triTable[cubeIndex];
        for (let i = 0; tri[i] !== -1; i += 3) {
          const a = vertList[tri[i]];
          const b = vertList[tri[i + 1]];
          const c = vertList[tri[i + 2]];

          positions.push(a[0], a[1], a[2]);
          positions.push(b[0], b[1], b[2]);
          positions.push(c[0], c[1], c[2]);

          // Compute face normal
          const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const nx = ab[1] * ac[2] - ab[2] * ac[1];
          const ny = ab[2] * ac[0] - ab[0] * ac[2];
          const nz = ab[0] * ac[1] - ab[1] * ac[0];
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          normals.push(nx / len, ny / len, nz / len);
          normals.push(nx / len, ny / len, nz / len);
          normals.push(nx / len, ny / len, nz / len);
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
  };
}

/**
 * 2D marching-squares fill. For each cell, emit triangles covering the
 * "inside" region (where the corner value satisfies the inside test).
 * Used to cap iso surfaces at supercell outer faces.
 *
 * Vertex index convention per cell (CCW from bottom-left):
 *   0 = v00 (iu, iv), 1 = v10 (iu+1, iv), 2 = v11 (iu+1, iv+1), 3 = v01 (iu, iv+1)
 *   4..7 = edge crossings e0 (v00-v10), e1 (v10-v11), e2 (v11-v01), e3 (v01-v00)
 *
 * The fixed `normal` is used for every emitted vertex (caps are planar).
 * Pass `fillBelow=true` to fill where `value <= level` (for negative lobe).
 */
export function marchingSquaresFill(
  data: Float32Array,   // 2D scalar field, data[iu * nv + iv]
  dims: [number, number],
  origin: [number, number, number],
  uAxis: [number, number, number],  // per-voxel u step in 3D
  vAxis: [number, number, number],  // per-voxel v step in 3D
  level: number,
  normal: [number, number, number],
  fillBelow = false,
): { positions: Float32Array; normals: Float32Array } {
  const [nu, nv] = dims;
  const positions: number[] = [];
  const normals: number[] = [];

  const inside = (val: number) => (fillBelow ? val <= level : val >= level);

  const interp = (a: [number, number, number], b: [number, number, number], va: number, vb: number): [number, number, number] => {
    if (Math.abs(vb - va) < 1e-10) return a;
    const t = (level - va) / (vb - va);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
  };

  const emit = (p: [number, number, number]) => {
    positions.push(p[0], p[1], p[2]);
    normals.push(normal[0], normal[1], normal[2]);
  };

  for (let iu = 0; iu < nu - 1; iu++) {
    for (let iv = 0; iv < nv - 1; iv++) {
      const v00 = data[iu * nv + iv];
      const v10 = data[(iu + 1) * nv + iv];
      const v11 = data[(iu + 1) * nv + (iv + 1)];
      const v01 = data[iu * nv + (iv + 1)];

      let idx = 0;
      if (inside(v00)) idx |= 1;
      if (inside(v10)) idx |= 2;
      if (inside(v11)) idx |= 4;
      if (inside(v01)) idx |= 8;
      if (idx === 0) continue;

      const p00: [number, number, number] = [
        origin[0] + iu * uAxis[0] + iv * vAxis[0],
        origin[1] + iu * uAxis[1] + iv * vAxis[1],
        origin[2] + iu * uAxis[2] + iv * vAxis[2],
      ];
      const p10: [number, number, number] = [p00[0] + uAxis[0], p00[1] + uAxis[1], p00[2] + uAxis[2]];
      const p11: [number, number, number] = [p10[0] + vAxis[0], p10[1] + vAxis[1], p10[2] + vAxis[2]];
      const p01: [number, number, number] = [p00[0] + vAxis[0], p00[1] + vAxis[1], p00[2] + vAxis[2]];

      const verts: ([number, number, number] | null)[] = [p00, p10, p11, p01, null, null, null, null];
      const edgeMask = CAPS_EDGE_MASK[idx];
      if (edgeMask & 1) verts[4] = interp(p00, p10, v00, v10);
      if (edgeMask & 2) verts[5] = interp(p10, p11, v10, v11);
      if (edgeMask & 4) verts[6] = interp(p11, p01, v11, v01);
      if (edgeMask & 8) verts[7] = interp(p01, p00, v01, v00);

      const polys = CAPS_FILL[idx];
      for (const poly of polys) {
        // Triangulate as fan from poly[0]
        const a = verts[poly[0]]!;
        for (let k = 1; k < poly.length - 1; k++) {
          const b = verts[poly[k]]!;
          const c = verts[poly[k + 1]]!;
          emit(a); emit(b); emit(c);
        }
      }
    }
  }

  return { positions: new Float32Array(positions), normals: new Float32Array(normals) };
}

// Which edges (e0..e3 = bits 0..3) need their crossing computed for each of the 16 cases.
const CAPS_EDGE_MASK: number[] = [
  0b0000, // 0
  0b1001, // 1: e0, e3
  0b0011, // 2: e0, e1
  0b1010, // 3: e1, e3
  0b0110, // 4: e1, e2
  0b1111, // 5 saddle: all
  0b0101, // 6: e0, e2
  0b1100, // 7: e2, e3
  0b1100, // 8: e2, e3
  0b0101, // 9: e0, e2
  0b1111, // 10 saddle: all
  0b0110, // 11: e1, e2
  0b1010, // 12: e1, e3
  0b0011, // 13: e0, e1
  0b1001, // 14: e0, e3
  0b0000, // 15
];

// Inside-region polygon (CCW) vertex indices per case.
// Saddle cases 5 and 10 yield two disjoint triangles.
const CAPS_FILL: number[][][] = [
  [],                     // 0
  [[0, 4, 7]],            // 1: v00
  [[1, 5, 4]],            // 2: v10
  [[0, 1, 5, 7]],         // 3: v00, v10
  [[2, 6, 5]],            // 4: v11
  [[0, 4, 7], [2, 6, 5]], // 5: v00, v11 saddle
  [[1, 2, 6, 4]],         // 6: v10, v11
  [[0, 1, 2, 6, 7]],      // 7: v00, v10, v11
  [[3, 7, 6]],            // 8: v01
  [[0, 4, 6, 3]],         // 9: v00, v01
  [[1, 5, 4], [3, 7, 6]], // 10: v10, v01 saddle
  [[0, 1, 5, 6, 3]],      // 11: v00, v10, v01
  [[5, 2, 3, 7]],         // 12: v11, v01
  [[0, 4, 5, 2, 3]],      // 13: v00, v11, v01
  [[4, 1, 2, 3, 7]],      // 14: v10, v11, v01
  [[0, 1, 2, 3]],         // 15: all
];
