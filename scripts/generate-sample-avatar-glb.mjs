import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outPath = path.join(repoRoot, "apps", "web", "public", "assets", "avatars", "sample-rigged.glb");

/**
 * Generates a self-contained, spec-compliant binary glTF 2.0 sculpted humanoid avatar
 * using smooth UV spheres & rounded cylinders/capsules (`8` skeleton joints +
 * `SkinnedMesh` + `6` keyframed animation clips: Idle, Walk, Sit, Type, Talk, RaiseHand).
 */

function eulerXyzToQuat(rx, ry, rz) {
  const cx = Math.cos(rx / 2);
  const sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2);
  const sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2);
  const sz = Math.sin(rz / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

const positions = [];
const normals = [];
const joints = [];
const weights = [];
const indices = [];

function appendEllipsoid(cx, cy, cz, rx, ry, rz, jointIndex, segU = 14, segV = 10) {
  const baseVertex = positions.length / 3;
  for (let v = 0; v <= segV; v += 1) {
    const phi = (v / segV) * Math.PI;
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    for (let u = 0; u <= segU; u += 1) {
      const theta = (u / segU) * Math.PI * 2;
      const nx = sinP * Math.cos(theta);
      const ny = cosP;
      const nz = sinP * Math.sin(theta);

      positions.push(cx + nx * rx, cy + ny * ry, cz + nz * rz);
      const invLen = 1 / (Math.hypot(nx / rx, ny / ry, nz / rz) || 1);
      normals.push((nx / rx) * invLen, (ny / ry) * invLen, (nz / rz) * invLen);
      joints.push(jointIndex, 0, 0, 0);
      weights.push(1, 0, 0, 0);
    }
  }
  const stride = segU + 1;
  for (let v = 0; v < segV; v += 1) {
    for (let u = 0; u < segU; u += 1) {
      const a = baseVertex + v * stride + u;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      if (v !== 0) indices.push(a, c, b);
      if (v !== segV - 1) indices.push(b, c, d);
    }
  }
}

function appendTaperedCapsule(cx, cy, cz, rTop, rBot, height, jointIndex, radialSegs = 14) {
  // Smooth cylinder with top & bottom domes (single seamless mesh per limb)
  const rings = [
    { yOff: -height / 2 - rBot * 0.65, r: rBot * 0.25, ny: -0.95 },
    { yOff: -height / 2, r: rBot, ny: -0.2 },
    { yOff: 0, r: (rTop + rBot) * 0.5, ny: 0 },
    { yOff: height / 2, r: rTop, ny: 0.2 },
    { yOff: height / 2 + rTop * 0.65, r: rTop * 0.25, ny: 0.95 },
  ];
  const baseVertex = positions.length / 3;
  for (const ring of rings) {
    for (let u = 0; u <= radialSegs; u += 1) {
      const theta = (u / radialSegs) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      positions.push(cx + cosT * ring.r, cy + ring.yOff, cz + sinT * ring.r);
      const nHoriz = Math.sqrt(Math.max(0.01, 1 - ring.ny * ring.ny));
      normals.push(cosT * nHoriz, ring.ny, sinT * nHoriz);
      joints.push(jointIndex, 0, 0, 0);
      weights.push(1, 0, 0, 0);
    }
  }
  const stride = radialSegs + 1;
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let u = 0; u < radialSegs; u += 1) {
      const a = baseVertex + r * stride + u;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
}

// Sculpted smooth proportions bound cleanly to the 8 skeleton joints:
// 0=Root, 1=Hips, 2=Spine, 3=Head, 4=LeftArm, 5=RightArm, 6=LeftLeg, 7=RightLeg
appendTaperedCapsule(0, 0.90, 0, 0.155, 0.145, 0.10, 1, 16); // Hips
appendTaperedCapsule(0, 1.18, 0, 0.195, 0.150, 0.36, 2, 16); // Sculpted Torso
appendEllipsoid(0, 1.43, 0, 0.055, 0.06, 0.055, 3, 10, 6); // Neck
appendEllipsoid(0, 1.59, 0, 0.135, 0.145, 0.135, 3, 16, 12); // Sculpted Head
appendTaperedCapsule(-0.23, 1.17, 0, 0.056, 0.044, 0.34, 4, 12); // LeftArm
appendTaperedCapsule(0.23, 1.17, 0, 0.056, 0.044, 0.34, 5, 12); // RightArm
appendTaperedCapsule(-0.095, 0.44, 0, 0.066, 0.050, 0.72, 6, 12); // LeftLeg
appendTaperedCapsule(0.095, 0.44, 0, 0.066, 0.050, 0.72, 7, 12); // RightLeg

const posArr = new Float32Array(positions);
const normArr = new Float32Array(normals);
const jointArr = new Uint8Array(joints);
const weightArr = new Float32Array(weights);
const indexArr = new Uint16Array(indices);

const posMin = [Infinity, Infinity, Infinity];
const posMax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < posArr.length; i += 3) {
  posMin[0] = Math.min(posMin[0], posArr[i]);
  posMin[1] = Math.min(posMin[1], posArr[i + 1]);
  posMin[2] = Math.min(posMin[2], posArr[i + 2]);
  posMax[0] = Math.max(posMax[0], posArr[i]);
  posMax[1] = Math.max(posMax[1], posArr[i + 1]);
  posMax[2] = Math.max(posMax[2], posArr[i + 2]);
}

const jointWorldOrigins = [
  [0, 0, 0],        // 0 Root
  [0, 0.9, 0],      // 1 Hips
  [0, 1.15, 0],     // 2 Spine
  [0, 1.57, 0],     // 3 Head
  [-0.23, 1.37, 0], // 4 LeftArm
  [0.23, 1.37, 0],  // 5 RightArm
  [-0.095, 0.85, 0],// 6 LeftLeg
  [0.095, 0.85, 0], // 7 RightLeg
];
const ibmArr = new Float32Array(jointWorldOrigins.length * 16);
jointWorldOrigins.forEach(([wx, wy, wz], idx) => {
  const o = idx * 16;
  ibmArr[o + 0] = 1;
  ibmArr[o + 5] = 1;
  ibmArr[o + 10] = 1;
  ibmArr[o + 15] = 1;
  ibmArr[o + 12] = -wx;
  ibmArr[o + 13] = -wy;
  ibmArr[o + 14] = -wz;
});

const binChunks = [];
let binOffset = 0;
const bufferViews = [];
const accessors = [];

function pushBufferView(typedArray, target) {
  const raw = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  const pad = (4 - (raw.length % 4)) % 4;
  const viewIdx = bufferViews.length;
  const view = {
    buffer: 0,
    byteOffset: binOffset,
    byteLength: raw.length,
  };
  if (target !== undefined) view.target = target;
  bufferViews.push(view);
  binChunks.push(raw);
  if (pad > 0) binChunks.push(Buffer.alloc(pad));
  binOffset += raw.length + pad;
  return viewIdx;
}

function addAccessor(viewIdx, componentType, count, type, min, max) {
  const accIdx = accessors.length;
  const acc = { bufferView: viewIdx, byteOffset: 0, componentType, count, type };
  if (min) acc.min = min;
  if (max) acc.max = max;
  accessors.push(acc);
  return accIdx;
}

const posView = pushBufferView(posArr, 34962);
const normView = pushBufferView(normArr, 34962);
const jointView = pushBufferView(jointArr, 34962);
const weightView = pushBufferView(weightArr, 34962);
const idxView = pushBufferView(indexArr, 34963);
const ibmView = pushBufferView(ibmArr, undefined);

const vertexCount = posArr.length / 3;
const posAcc = addAccessor(posView, 5126, vertexCount, "VEC3", posMin, posMax);
const normAcc = addAccessor(normView, 5126, vertexCount, "VEC3");
const jointAcc = addAccessor(jointView, 5121, vertexCount, "VEC4");
const weightAcc = addAccessor(weightView, 5126, vertexCount, "VEC4");
const idxAcc = addAccessor(idxView, 5123, indexArr.length, "SCALAR");
const ibmAcc = addAccessor(ibmView, 5126, jointWorldOrigins.length, "MAT4");

const animations = [];
function addClip(name, tracks) {
  const samplers = [];
  const channels = [];
  for (const track of tracks) {
    const times = new Float32Array(track.times);
    const values = new Float32Array(track.values.flat());
    const tView = pushBufferView(times);
    const vView = pushBufferView(values);
    const tAcc = addAccessor(tView, 5126, times.length, "SCALAR", [times[0]], [times[times.length - 1]]);
    const vAcc = addAccessor(vView, 5126, times.length, track.path === "translation" ? "VEC3" : "VEC4");
    const samplerIdx = samplers.length;
    samplers.push({ input: tAcc, interpolation: "LINEAR", output: vAcc });
    channels.push({ sampler: samplerIdx, target: { node: track.node, path: track.path } });
  }
  animations.push({ name, samplers, channels });
}

addClip("Idle", [
  { node: 1, path: "translation", times: [0, 1.0, 2.0], values: [[0, 0.9, 0], [0, 0.92, 0], [0, 0.9, 0]] },
  { node: 2, path: "rotation", times: [0, 1.0, 2.0], values: [eulerXyzToQuat(0, 0, 0), eulerXyzToQuat(0.03, 0, 0), eulerXyzToQuat(0, 0, 0)] },
  { node: 4, path: "rotation", times: [0, 1.0, 2.0], values: [eulerXyzToQuat(0, 0, -0.06), eulerXyzToQuat(0.04, 0, -0.08), eulerXyzToQuat(0, 0, -0.06)] },
  { node: 5, path: "rotation", times: [0, 1.0, 2.0], values: [eulerXyzToQuat(0, 0, 0.06), eulerXyzToQuat(-0.04, 0, 0.08), eulerXyzToQuat(0, 0, 0.06)] },
]);

addClip("Walk", [
  { node: 1, path: "translation", times: [0, 0.2, 0.4, 0.6, 0.8], values: [[0, 0.9, 0], [0, 0.94, 0], [0, 0.9, 0], [0, 0.94, 0], [0, 0.9, 0]] },
  { node: 6, path: "rotation", times: [0, 0.2, 0.4, 0.6, 0.8], values: [eulerXyzToQuat(0, 0, 0), eulerXyzToQuat(-0.48, 0, 0), eulerXyzToQuat(0, 0, 0), eulerXyzToQuat(0.48, 0, 0), eulerXyzToQuat(0, 0, 0)] },
  { node: 7, path: "rotation", times: [0, 0.2, 0.4, 0.6, 0.8], values: [eulerXyzToQuat(0, 0, 0), eulerXyzToQuat(0.48, 0, 0), eulerXyzToQuat(0, 0, 0), eulerXyzToQuat(-0.48, 0, 0), eulerXyzToQuat(0, 0, 0)] },
  { node: 4, path: "rotation", times: [0, 0.2, 0.4, 0.6, 0.8], values: [eulerXyzToQuat(0, 0, -0.08), eulerXyzToQuat(0.38, 0, -0.08), eulerXyzToQuat(0, 0, -0.08), eulerXyzToQuat(-0.38, 0, -0.08), eulerXyzToQuat(0, 0, -0.08)] },
  { node: 5, path: "rotation", times: [0, 0.2, 0.4, 0.6, 0.8], values: [eulerXyzToQuat(0, 0, 0.08), eulerXyzToQuat(-0.38, 0, 0.08), eulerXyzToQuat(0, 0, 0.08), eulerXyzToQuat(0.38, 0, 0.08), eulerXyzToQuat(0, 0, 0.08)] },
]);

addClip("Sit", [
  { node: 1, path: "translation", times: [0, 1.0, 2.0], values: [[0, 0.56, -0.04], [0, 0.57, -0.04], [0, 0.56, -0.04]] },
  { node: 6, path: "rotation", times: [0, 2.0], values: [eulerXyzToQuat(-1.42, 0, 0), eulerXyzToQuat(-1.42, 0, 0)] },
  { node: 7, path: "rotation", times: [0, 2.0], values: [eulerXyzToQuat(-1.42, 0, 0), eulerXyzToQuat(-1.42, 0, 0)] },
  { node: 4, path: "rotation", times: [0, 1.0, 2.0], values: [eulerXyzToQuat(-0.42, 0, -0.08), eulerXyzToQuat(-0.46, 0, -0.08), eulerXyzToQuat(-0.42, 0, -0.08)] },
  { node: 5, path: "rotation", times: [0, 1.0, 2.0], values: [eulerXyzToQuat(-0.42, 0, 0.08), eulerXyzToQuat(-0.46, 0, 0.08), eulerXyzToQuat(-0.42, 0, 0.08)] },
]);

addClip("Type", [
  { node: 1, path: "translation", times: [0, 0.6], values: [[0, 0.56, -0.04], [0, 0.56, -0.04]] },
  { node: 6, path: "rotation", times: [0, 0.6], values: [eulerXyzToQuat(-1.42, 0, 0), eulerXyzToQuat(-1.42, 0, 0)] },
  { node: 7, path: "rotation", times: [0, 0.6], values: [eulerXyzToQuat(-1.42, 0, 0), eulerXyzToQuat(-1.42, 0, 0)] },
  { node: 2, path: "rotation", times: [0, 0.3, 0.6], values: [eulerXyzToQuat(0.12, 0, 0), eulerXyzToQuat(0.16, 0, 0), eulerXyzToQuat(0.12, 0, 0)] },
  { node: 4, path: "rotation", times: [0, 0.15, 0.3, 0.45, 0.6], values: [eulerXyzToQuat(-1.12, -0.1, 0), eulerXyzToQuat(-0.95, -0.1, 0), eulerXyzToQuat(-1.15, -0.1, 0), eulerXyzToQuat(-0.98, -0.1, 0), eulerXyzToQuat(-1.12, -0.1, 0)] },
  { node: 5, path: "rotation", times: [0, 0.15, 0.3, 0.45, 0.6], values: [eulerXyzToQuat(-0.96, 0.1, 0), eulerXyzToQuat(-1.15, 0.1, 0), eulerXyzToQuat(-0.95, 0.1, 0), eulerXyzToQuat(-1.14, 0.1, 0), eulerXyzToQuat(-0.96, 0.1, 0)] },
]);

addClip("Talk", [
  { node: 1, path: "translation", times: [0, 0.8, 1.6], values: [[0, 0.56, -0.04], [0, 0.58, -0.04], [0, 0.56, -0.04]] },
  { node: 6, path: "rotation", times: [0, 1.6], values: [eulerXyzToQuat(-1.42, 0, 0), eulerXyzToQuat(-1.42, 0, 0)] },
  { node: 7, path: "rotation", times: [0, 1.6], values: [eulerXyzToQuat(-1.42, 0, 0), eulerXyzToQuat(-1.42, 0, 0)] },
  { node: 3, path: "rotation", times: [0, 0.4, 0.8, 1.2, 1.6], values: [eulerXyzToQuat(0, 0, 0), eulerXyzToQuat(0.08, 0.14, 0), eulerXyzToQuat(-0.04, 0, 0), eulerXyzToQuat(0.06, -0.14, 0), eulerXyzToQuat(0, 0, 0)] },
  { node: 4, path: "rotation", times: [0, 0.4, 0.8, 1.2, 1.6], values: [eulerXyzToQuat(-0.7, 0, -0.12), eulerXyzToQuat(-1.1, 0, -0.22), eulerXyzToQuat(-0.75, 0, -0.12), eulerXyzToQuat(-1.05, 0, -0.18), eulerXyzToQuat(-0.7, 0, -0.12)] },
  { node: 5, path: "rotation", times: [0, 0.4, 0.8, 1.2, 1.6], values: [eulerXyzToQuat(-0.7, 0, 0.12), eulerXyzToQuat(-0.85, 0, 0.14), eulerXyzToQuat(-1.15, 0, 0.24), eulerXyzToQuat(-0.8, 0, 0.12), eulerXyzToQuat(-0.7, 0, 0.12)] },
]);

addClip("RaiseHand", [
  { node: 1, path: "translation", times: [0, 0.7, 1.4], values: [[0, 0.9, 0], [0, 0.92, 0], [0, 0.9, 0]] },
  { node: 5, path: "rotation", times: [0, 0.7, 1.4], values: [eulerXyzToQuat(-2.6, 0, 0.18), eulerXyzToQuat(-2.78, 0, 0.26), eulerXyzToQuat(-2.6, 0, 0.18)] },
  { node: 4, path: "rotation", times: [0, 0.7, 1.4], values: [eulerXyzToQuat(0, 0, -0.1), eulerXyzToQuat(0.06, 0, -0.12), eulerXyzToQuat(0, 0, -0.1)] },
]);

const binBuffer = Buffer.concat(binChunks);

const gltf = {
  asset: {
    version: "2.0",
    generator: "virtual-office-sculpted-glb-generator",
  },
  scene: 0,
  scenes: [{ name: "AvatarScene", nodes: [0, 8] }],
  nodes: [
    { name: "Root", children: [1] }, // 0
    { name: "Hips", translation: [0, 0.9, 0], children: [2, 6, 7] }, // 1
    { name: "Spine", translation: [0, 0.25, 0], children: [3, 4, 5] }, // 2
    { name: "Head", translation: [0, 0.42, 0] }, // 3
    { name: "LeftArm", translation: [-0.23, 0.22, 0] }, // 4
    { name: "RightArm", translation: [0.23, 0.22, 0] }, // 5
    { name: "LeftLeg", translation: [-0.095, -0.05, 0] }, // 6
    { name: "RightLeg", translation: [0.095, -0.05, 0] }, // 7
    { name: "BodyMesh", mesh: 0, skin: 0 }, // 8
  ],
  skins: [
    {
      name: "HumanSkin",
      inverseBindMatrices: ibmAcc,
      skeleton: 0,
      joints: [0, 1, 2, 3, 4, 5, 6, 7],
    },
  ],
  materials: [
    {
      name: "AvatarMaterial",
      pbrMetallicRoughness: {
        baseColorFactor: [0.78, 0.75, 0.72, 1],
        metallicFactor: 0.12,
        roughnessFactor: 0.48,
      },
    },
  ],
  meshes: [
    {
      name: "SculptedHumanMesh",
      primitives: [
        {
          attributes: {
            POSITION: posAcc,
            NORMAL: normAcc,
            JOINTS_0: jointAcc,
            WEIGHTS_0: weightAcc,
          },
          indices: idxAcc,
          material: 0,
        },
      ],
    },
  ],
  animations,
  bufferViews,
  accessors,
  buffers: [{ byteLength: binBuffer.length }],
};

const jsonRaw = Buffer.from(JSON.stringify(gltf), "utf8");
const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
const jsonBuffer = jsonPad > 0 ? Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]) : jsonRaw;

const totalLength = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;
const out = Buffer.alloc(totalLength);
let ptr = 0;

out.writeUInt32LE(0x46546c67, ptr); ptr += 4;
out.writeUInt32LE(2, ptr); ptr += 4;
out.writeUInt32LE(totalLength, ptr); ptr += 4;

out.writeUInt32LE(jsonBuffer.length, ptr); ptr += 4;
out.writeUInt32LE(0x4e4f534a, ptr); ptr += 4;
jsonBuffer.copy(out, ptr); ptr += jsonBuffer.length;

out.writeUInt32LE(binBuffer.length, ptr); ptr += 4;
out.writeUInt32LE(0x004e4942, ptr); ptr += 4;
binBuffer.copy(out, ptr);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
console.log(
  `Generated sculpted ${outPath} (${out.length} bytes, ${vertexCount} vertices, ${indexArr.length / 3} triangles, ${animations.length} clips)`,
);
