import { mountHiddenVideoJsPlayer, changeVideoSource } from "./videojs-player-host.js";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import "./style.css";

const canvas = document.getElementById("scene");
const statusEl = document.getElementById("status");
const telemetryEl = document.getElementById("telemetry");
const crosshairEl = document.getElementById("crosshair");
const cursorLockButton = document.getElementById("cursor-lock");
const playButton = document.getElementById("video-play");
const pauseButton = document.getElementById("video-pause");

const TAPE_PICKUP_RADIUS = 2.25;
const TAPE_PICKUP_DOT_THRESHOLD = 0.96;
const TAPE_HOLD_OFFSET = {
  right: 0.38,
  up: -0.22,
  forward: 1.05,
};
const TAPE_HOLD_YAW_OFFSET = -0.35;
const TAPE_DROP_DISTANCE = 1.5;

const VCR_INSERT_RADIUS = 2.5;
const VCR_INSERT_DOT_THRESHOLD = 0.9;
const VCR_POSITION = new THREE.Vector3(0.0, 0.0, -6.75);

const TAPE_VIDEO_DATA = {
  playbackId: "9iUYcsVCtyyWdPfHFsJNreL3j01K2V1xizq4ZcYHwXQs",
  get src() {
    return `https://stream.mux.com/${this.playbackId}.m3u8`;
  },
  get poster() {
    return `https://image.mux.com/${this.playbackId}/storyboard.png`;
  },
  title: "Demo Reel",
};

const BOOMBOX_MODEL_CONFIG = {
  url: "/BoomBox.fbx",
  targetMaxDim: 2.2,
  rotation: new THREE.Euler(0.0, -0.22 * Math.PI, 0.0),
  position: new THREE.Vector3(3.8, 0.0, -9.15),
  floorOffset: 0.03,
};

const TAPE_MODEL_CONFIG = {
  url: "/tape.glb",
  targetMaxDim: 2.2,
  rotation: new THREE.Euler(0.0, 0.18 * Math.PI, 0.0),
  position: new THREE.Vector3(-5.0, 0.0, -9.25),
  floorOffset: 0.03,
};

const PLAYER_MODEL_CONFIG = {
  url: "/player.glb",
  targetMaxDim: 1.7,
  rotation: new THREE.Euler(0.0, 0.0, 0.0),
  position: new THREE.Vector3(0.0, 0.0, -6.75),
  floorOffset: 0.03,
};

if (!navigator.gpu) {
  statusEl.textContent = "WebGPU is not available in this browser.";
  throw new Error("WebGPU unavailable");
}

const decoder = new TextDecoder();
let baseStatusMessage = "Booting...";
let contextualStatusMessage = "";

function readBytes(memory, ptr, len) {
  return new Uint8Array(memory.buffer, ptr, len);
}

function readString(memory, ptr, len) {
  return decoder.decode(readBytes(memory, ptr, len));
}

function unpackResult(packed) {
  const value = BigInt(packed);
  const ptr = Number(value & 0xffffffffn);
  const len = Number((value >> 32n) & 0xffffffffn);
  return { ptr, len };
}

async function instantiateZigWasm(url) {
  if (WebAssembly.instantiateStreaming) {
    const streamResponse = await fetch(url);
    if (!streamResponse.ok) {
      throw new Error(`Failed to fetch ${url}: ${streamResponse.status}`);
    }
    try {
      return await WebAssembly.instantiateStreaming(streamResponse, {});
    } catch {
      // Fallback for servers that do not send application/wasm MIME.
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  return await WebAssembly.instantiate(bytes, {});
}

function readError(exports) {
  return readString(
    exports.memory,
    exports.last_error_ptr(),
    exports.last_error_len(),
  );
}

function getVideoShaderFromZig(exports) {
  const packed = exports.video_shader_wgsl();
  const { ptr, len } = unpackResult(packed);
  if (!ptr || !len) {
    throw new Error(readError(exports) || "video shader export returned empty");
  }
  const source = readString(exports.memory, ptr, len);
  exports.free(ptr, len);
  return source;
}

function getTvFrameShaderFromZig(exports) {
  const packed = exports.tv_frame_shader_wgsl();
  const { ptr, len } = unpackResult(packed);
  if (!ptr || !len) {
    throw new Error(
      readError(exports) || "tv frame shader export returned empty",
    );
  }
  const source = readString(exports.memory, ptr, len);
  exports.free(ptr, len);
  return source;
}

function getBoomBoxShaderFromZig(exports) {
  const packed = exports.boombox_shader_wgsl();
  const { ptr, len } = unpackResult(packed);
  if (!ptr || !len) {
    throw new Error(
      readError(exports) || "boombox shader export returned empty",
    );
  }
  const source = readString(exports.memory, ptr, len);
  exports.free(ptr, len);
  return source;
}

function getArchTextShaderFromZig(exports) {
  const packed = exports.arch_text_shader_wgsl();
  const { ptr, len } = unpackResult(packed);
  if (!ptr || !len) {
    throw new Error(
      readError(exports) || "arch text shader export returned empty",
    );
  }
  const source = readString(exports.memory, ptr, len);
  exports.free(ptr, len);
  return source;
}

function createDepthTexture(device, width, height) {
  return device.createTexture({
    size: [width, height, 1],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

function getWoodFloorShaderCode() {
  return /* wgsl */ `
struct Camera {
  view_proj: mat4x4<f32>,
};

struct FloorMaterial {
  uv_scale: vec2<f32>,
  normal_strength: f32,
  roughness_bias: f32,
  tint: vec3<f32>,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var floor_sampler: sampler;
@group(1) @binding(1) var floor_albedo_tex: texture_2d<f32>;
@group(1) @binding(2) var floor_normal_tex: texture_2d<f32>;
@group(1) @binding(3) var floor_roughness_tex: texture_2d<f32>;
@group(1) @binding(4) var<uniform> floor_material: FloorMaterial;

struct VsIn {
  @location(0) position: vec3<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
  var out: VsOut;
  out.uv = in.position.xz;
  out.clip_position = camera.view_proj * vec4<f32>(in.position, 1.0);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let uv = in.uv * floor_material.uv_scale;
  let albedo = textureSample(floor_albedo_tex, floor_sampler, uv).rgb * floor_material.tint;
  let normal_sample = textureSample(floor_normal_tex, floor_sampler, uv).xyz * 2.0 - vec3<f32>(1.0, 1.0, 1.0);
  let tangent_normal = normalize(vec3<f32>(
    normal_sample.x * floor_material.normal_strength,
    normal_sample.y * floor_material.normal_strength,
    max(normal_sample.z, 0.05),
  ));
  let normal_ws = normalize(vec3<f32>(tangent_normal.x, tangent_normal.z, tangent_normal.y));

  let roughness = clamp(textureSample(floor_roughness_tex, floor_sampler, uv).r + floor_material.roughness_bias, 0.04, 1.0);
  let sun_dir = normalize(vec3<f32>(0.25, 1.0, 0.15));
  let view_dir = normalize(vec3<f32>(0.0, 1.0, 0.0));
  let ndotl = max(dot(normal_ws, sun_dir), 0.0);
  let half_vec = normalize(sun_dir + view_dir);

  let spec_power = mix(128.0, 24.0, roughness);
  let specular = pow(max(dot(normal_ws, half_vec), 0.0), spec_power) * (1.0 - roughness) * 0.18;
  let hemi = clamp(normal_ws.y * 0.5 + 0.5, 0.0, 1.0);
  let ambient = mix(vec3<f32>(0.08, 0.06, 0.04), vec3<f32>(0.22, 0.18, 0.13), hemi);

  let color = albedo * (0.25 + 0.75 * ndotl) + albedo * ambient * 0.5 + vec3<f32>(specular);
  return vec4<f32>(color, 1.0);
}
`;
}

function hash2D(x, y, seed) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function wrapIndex(value, size) {
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

// Attempt a smooth value noise for coherent grain lines
function smoothNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Smoothstep interpolation
  const sx = fx * fx * (3.0 - 2.0 * fx);
  const sy = fy * fy * (3.0 - 2.0 * fy);
  const a = hash2D(ix, iy, seed);
  const b = hash2D(ix + 1, iy, seed);
  const c = hash2D(ix, iy + 1, seed);
  const d = hash2D(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Fractal brownian motion -- stacks smooth noise at multiple scales
function fbm(x, y, seed, octaves = 4) {
  let value = 0.0;
  let amplitude = 0.5;
  let frequency = 1.0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * smoothNoise(x * frequency, y * frequency, seed + i * 31.7);
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value;
}

function createWoodFloorTextures(device, size = 512) {
  const pixelCount = size * size;
  const heightData = new Float32Array(pixelCount);
  const albedoData = new Uint8Array(pixelCount * 4);
  const normalData = new Uint8Array(pixelCount * 4);
  const roughnessData = new Uint8Array(pixelCount);

  // Plank layout: 6 planks running horizontally, staggered end-joints
  const PLANK_COUNT = 6;
  const plankH = size / PLANK_COUNT;
  // Each plank has 2 end-joints (splits along X) at staggered positions
  const plankSeeds = [];
  for (let i = 0; i < PLANK_COUNT; i++) {
    plankSeeds.push({
      grainSeed: 1.0 + i * 7.3,
      colorShift: hash2D(i, 0, 42.1),       // per-plank color variation
      grainOffset: hash2D(i, 1, 88.3) * 20,  // offset grain phase per plank
      // Staggered end-joints: each row's splits are offset from the previous
      jointX: Math.floor(size * (0.3 + hash2D(i, 2, 55.0) * 0.4)),
    });
  }

  const SEAM_WIDTH = Math.max(1, Math.round(size * 0.004));  // ~2px at 512
  const JOINT_WIDTH = Math.max(1, Math.round(size * 0.003)); // ~1-2px

  // Generate height/grain data
  for (let py = 0; py < size; py++) {
    const plankIdx = Math.min(Math.floor(py / plankH), PLANK_COUNT - 1);
    const plank = plankSeeds[plankIdx];

    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;

      // Grain runs along x, with gentle waviness from fbm
      const warp = fbm(u * 3.0, v * 2.0, plank.grainSeed, 3) * 0.4;
      const grainCoord = v * 40.0 + plank.grainOffset + warp;

      // Primary grain: smooth sine-based rings
      const grain = 0.5 + 0.5 * Math.sin(grainCoord);
      // Secondary finer grain
      const fineGrain = 0.5 + 0.5 * Math.sin(grainCoord * 3.7 + u * 8.0);
      // Subtle noise for micro-texture
      const microNoise = smoothNoise(px * 0.08, py * 0.08, plank.grainSeed + 100);

      // Occasional knot
      const knotCx = size * (0.2 + hash2D(plankIdx, 3, 19.0) * 0.6);
      const knotCy = plankIdx * plankH + plankH * (0.3 + hash2D(plankIdx, 4, 23.0) * 0.4);
      const knotDist = Math.hypot(px - knotCx, (py - knotCy) * 1.5) / (size * 0.03);
      const knot = Math.max(0, 1.0 - knotDist);
      const knotRings = knot > 0.01 ? 0.5 + 0.5 * Math.sin(knotDist * 12.0) : 0;

      const h = grain * 0.45 + fineGrain * 0.25 + microNoise * 0.15 + knotRings * knot * 0.15;
      heightData[py * size + px] = h;
    }
  }

  // Generate albedo, normals, roughness
  for (let py = 0; py < size; py++) {
    const plankIdx = Math.min(Math.floor(py / plankH), PLANK_COUNT - 1);
    const plank = plankSeeds[plankIdx];
    const plankLocalY = (py % plankH);
    const yDown = wrapIndex(py - 1, size);
    const yUp = wrapIndex(py + 1, size);

    for (let px = 0; px < size; px++) {
      const xLeft = wrapIndex(px - 1, size);
      const xRight = wrapIndex(px + 1, size);
      const idx = py * size + px;
      const idx4 = idx * 4;

      const h = heightData[idx];
      const hLeft = heightData[py * size + xLeft];
      const hRight = heightData[py * size + xRight];
      const hDown = heightData[yDown * size + px];
      const hUp = heightData[yUp * size + px];

      // Seam detection: horizontal seams between planks
      const isHSeam = plankLocalY < SEAM_WIDTH || plankLocalY >= (plankH - SEAM_WIDTH);
      // Vertical end-joints per plank
      const jointDist = Math.abs(px - plank.jointX);
      const isVJoint = jointDist < JOINT_WIDTH;
      const isSeam = isHSeam || isVJoint;

      // Per-plank base wood colors (warm brown spectrum)
      const shift = plank.colorShift;
      // Darker planks: reddish-brown, lighter planks: honey/amber
      const baseR = 130 + shift * 45 + h * 40;
      const baseG = 85 + shift * 30 + h * 28;
      const baseB = 48 + shift * 15 + h * 15;

      // Knot darkening
      const knotCx = size * (0.2 + hash2D(plankIdx, 3, 19.0) * 0.6);
      const knotCy = plankIdx * plankH + plankH * (0.3 + hash2D(plankIdx, 4, 23.0) * 0.4);
      const knotDist = Math.hypot(px - knotCx, (py - knotCy) * 1.5) / (size * 0.035);
      const knotDarken = Math.max(0, 1.0 - knotDist);
      const knotMul = 1.0 - knotDarken * 0.35;

      let r, g, b;
      if (isSeam) {
        // Seams are darker, slightly cooler
        r = baseR * 0.35;
        g = baseG * 0.3;
        b = baseB * 0.35;
      } else {
        r = baseR * knotMul;
        g = baseG * knotMul;
        b = baseB * knotMul;
      }

      albedoData[idx4 + 0] = Math.max(0, Math.min(255, Math.round(r)));
      albedoData[idx4 + 1] = Math.max(0, Math.min(255, Math.round(g)));
      albedoData[idx4 + 2] = Math.max(0, Math.min(255, Math.round(b)));
      albedoData[idx4 + 3] = 255;

      // Normal map
      const slopeX = hRight - hLeft;
      const slopeY = hUp - hDown;
      const seamBump = isSeam ? 0.6 : 0.0;
      const nx = -slopeX * 1.6;
      const ny = -slopeY * 1.6 - seamBump;
      const nz = 1.0;
      const normalLen = Math.hypot(nx, ny, nz) || 1.0;
      normalData[idx4 + 0] = Math.round(((nx / normalLen) * 0.5 + 0.5) * 255);
      normalData[idx4 + 1] = Math.round(((ny / normalLen) * 0.5 + 0.5) * 255);
      normalData[idx4 + 2] = Math.round(((nz / normalLen) * 0.5 + 0.5) * 255);
      normalData[idx4 + 3] = 255;

      // Roughness: seams rougher, polished wood smoother, knots rougher
      let roughness;
      if (isSeam) {
        roughness = 0.75;
      } else {
        roughness = 0.25 + h * 0.15 + knotDarken * 0.2;
      }
      roughnessData[idx] = Math.round(Math.max(0, Math.min(1, roughness)) * 255);
    }
  }

  const textureSize = [size, size, 1];
  const albedoTexture = device.createTexture({
    size: textureSize,
    format: "rgba8unorm-srgb",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const normalTexture = device.createTexture({
    size: textureSize,
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const roughnessTexture = device.createTexture({
    size: textureSize,
    format: "r8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  device.queue.writeTexture(
    { texture: albedoTexture },
    albedoData,
    { bytesPerRow: size * 4 },
    textureSize,
  );
  device.queue.writeTexture(
    { texture: normalTexture },
    normalData,
    { bytesPerRow: size * 4 },
    textureSize,
  );
  device.queue.writeTexture(
    { texture: roughnessTexture },
    roughnessData,
    { bytesPerRow: size },
    textureSize,
  );

  return {
    albedoTexture,
    normalTexture,
    roughnessTexture,
  };
}

function axis(positive, negative) {
  return (positive ? 1 : 0) - (negative ? 1 : 0);
}

function uploadBuffer(device, values, usage) {
  const buffer = device.createBuffer({
    size: values.byteLength,
    usage,
    mappedAtCreation: true,
  });
  const dst = new Float32Array(buffer.getMappedRange());
  dst.set(values);
  buffer.unmap();
  return buffer;
}

function status(message) {
  baseStatusMessage = message;
  renderStatus();
}

function setContextStatus(message) {
  contextualStatusMessage = message;
  renderStatus();
}

function renderStatus() {
  statusEl.textContent = contextualStatusMessage
    ? `${baseStatusMessage} ${contextualStatusMessage}`
    : baseStatusMessage;
}

function createArchBannerVertices() {
  const segments = 48;
  const width = 10.6;
  const archHeight = 0.62;
  const centerY = 3.92;
  const halfBand = 0.36;
  const z = -9.78;
  const vertices = [];

  for (let i = 0; i < segments; i += 1) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;

    const x0 = (t0 - 0.5) * width;
    const x1 = (t1 - 0.5) * width;
    const y0 = centerY + Math.sin(Math.PI * t0) * archHeight;
    const y1 = centerY + Math.sin(Math.PI * t1) * archHeight;

    const y0Top = y0 + halfBand;
    const y0Bot = y0 - halfBand;
    const y1Top = y1 + halfBand;
    const y1Bot = y1 - halfBand;

    // Triangle 1
    vertices.push(x0, y0Top, z, t0, 0.0);
    vertices.push(x1, y1Top, z, t1, 0.0);
    vertices.push(x1, y1Bot, z, t1, 1.0);
    // Triangle 2
    vertices.push(x0, y0Top, z, t0, 0.0);
    vertices.push(x1, y1Bot, z, t1, 1.0);
    vertices.push(x0, y0Bot, z, t0, 1.0);
  }

  return new Float32Array(vertices);
}

function createArchTextTexture(device) {
  const width = 1400;
  const height = 320;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create 2D canvas context for arch text");
  }

  const panelGradient = ctx.createLinearGradient(0, 0, 0, height);
  panelGradient.addColorStop(0.0, "rgba(8, 24, 40, 0.94)");
  panelGradient.addColorStop(1.0, "rgba(14, 40, 64, 0.94)");

  const textGradient = ctx.createLinearGradient(0, 0, width, height);
  textGradient.addColorStop(0.0, "rgba(251, 246, 228, 1)");
  textGradient.addColorStop(0.52, "rgba(194, 231, 255, 1)");
  textGradient.addColorStop(1.0, "rgba(255, 214, 160, 1)");

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = panelGradient;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(170, 212, 245, 0.72)";
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, width - 20, height - 20);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 154px 'Avenir Next', 'Trebuchet MS', sans-serif";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(5, 15, 24, 0.9)";
  ctx.lineWidth = 18;
  ctx.strokeText("VJS 10 Theater", width / 2, height / 2);
  ctx.fillStyle = textGradient;
  ctx.fillText("VJS 10 Theater", width / 2, height / 2);

  const texture = device.createTexture({
    size: [width, height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.copyExternalImageToTexture({ source: canvasEl }, { texture }, [
    width,
    height,
  ]);
  return texture;
}

function getLoadedRoot(loaded) {
  if (loaded instanceof THREE.Object3D) {
    return loaded;
  }
  if (loaded?.scene instanceof THREE.Object3D) {
    return loaded.scene;
  }
  throw new Error("Loaded asset did not contain a scene graph");
}

async function loadStaticModelVertices({
  loader,
  url,
  targetMaxDim,
  rotation,
  position,
  floorOffset = 0.03,
}) {
  const mesh = await loadModelMesh({
    loader,
    url,
    targetMaxDim,
    floorOffset,
  });
  return {
    vertices: bakeModelVertices(mesh.vertices, position, rotation),
    scale: mesh.scale,
    maxDim: mesh.maxDim,
  };
}

async function loadModelMesh({ loader, url, targetMaxDim, floorOffset = 0.03 }) {
  const loaded = await loader.loadAsync(url);
  const root = getLoadedRoot(loaded);

  // Normalize model size so different source unit scales still appear in scene.
  root.position.set(0.0, 0.0, 0.0);
  root.rotation.set(0.0, 0.0, 0.0);
  root.scale.setScalar(1.0);
  root.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(root);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z);
  const scale =
    Number.isFinite(maxDim) && maxDim > 0.000001 ? targetMaxDim / maxDim : 1.0;

  root.scale.setScalar(scale);
  root.rotation.set(0.0, 0.0, 0.0);
  root.position.set(0.0, 0.0, 0.0);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.set(-center.x, floorOffset - box.min.y, -center.z);
  root.updateMatrixWorld(true);

  const vertices = collectModelVertices(root);

  if (vertices.length === 0) {
    throw new Error(`${url} had no mesh vertices`);
  }

  const localBounds = new THREE.Box3().setFromArray(vertices);
  return {
    vertices,
    bounds: localBounds,
    scale,
    maxDim,
  };
}

function collectModelVertices(root) {
  const vertices = [];
  const temp = new THREE.Vector3();

  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geometry = node.geometry;
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const index = geometry.getIndex();
    const matrix = node.matrixWorld;

    if (index) {
      for (let i = 0; i < index.count; i += 1) {
        const vi = index.getX(i);
        temp.fromBufferAttribute(positions, vi).applyMatrix4(matrix);
        vertices.push(temp.x, temp.y, temp.z);
      }
      return;
    }

    for (let i = 0; i < positions.count; i += 1) {
      temp.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      vertices.push(temp.x, temp.y, temp.z);
    }
  });

  return new Float32Array(vertices);
}

function bakeModelVertices(localVertices, position, rotation) {
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);
  return transformModelVertices(localVertices, position, quaternion);
}

function transformModelVertices(localVertices, position, quaternion, target) {
  const transformed = target ?? new Float32Array(localVertices.length);
  const matrix = new THREE.Matrix4().compose(
    position,
    quaternion,
    new THREE.Vector3(1.0, 1.0, 1.0),
  );
  const temp = new THREE.Vector3();

  for (let i = 0; i < localVertices.length; i += 3) {
    temp.set(localVertices[i], localVertices[i + 1], localVertices[i + 2]);
    temp.applyMatrix4(matrix);
    transformed[i] = temp.x;
    transformed[i + 1] = temp.y;
    transformed[i + 2] = temp.z;
  }

  return transformed;
}

function createWritableVertexBuffer(device, values) {
  const buffer = device.createBuffer({
    size: values.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, values);
  return buffer;
}

async function main() {
  const mountedPlayer = await mountHiddenVideoJsPlayer({
    containerId: "videojs-player-root",
  });
  let videoElement = mountedPlayer.videoElement;
  const getMountedVideoElement = mountedPlayer.getVideoElement;

  videoElement.muted = false;
  videoElement.playsInline = true;
  videoElement.loop = true;

  let videoRenderEnabled = true;
  let videoRenderError = "";
  let tapeInserted = false;

  playButton.addEventListener("click", () => {
    videoElement.muted = false;
    const playPromise = videoElement.play();
    playPromise.catch(() => {
      status("Could not start video playback. Check browser autoplay policy.");
    });
  });
  pauseButton.addEventListener("click", () => {
    videoElement.pause();
  });
  cursorLockButton.addEventListener("click", () => {
    canvas.requestPointerLock();
  });

  const { instance } = await instantiateZigWasm("./webgpu_world.wasm");
  const wasm = instance.exports;
  const floorShaderCode = getWoodFloorShaderCode();
  const frameShaderCode = getTvFrameShaderFromZig(wasm);
  const boomboxShaderCode = getBoomBoxShaderFromZig(wasm);
  const archTextShaderCode = getArchTextShaderFromZig(wasm);
  const videoShaderCode = getVideoShaderFromZig(wasm);

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter available");
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  const floorPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: device.createShaderModule({ code: floorShaderCode }),
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: floorShaderCode }),
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "none",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const videoPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: device.createShaderModule({ code: videoShaderCode }),
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 20,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x2" },
          ],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: videoShaderCode }),
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "none",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const framePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: device.createShaderModule({ code: frameShaderCode }),
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: frameShaderCode }),
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "back",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const boomboxPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: device.createShaderModule({ code: boomboxShaderCode }),
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: boomboxShaderCode }),
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "none",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const archTextPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: device.createShaderModule({ code: archTextShaderCode }),
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 20,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x2" },
          ],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: archTextShaderCode }),
      entryPoint: "fs_main",
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "none",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less",
    },
  });

  const floorVertices = new Float32Array(
    wasm.memory.buffer,
    wasm.floor_vertex_ptr(),
    wasm.floor_vertex_len(),
  );
  const floorVertexBuffer = uploadBuffer(
    device,
    new Float32Array(floorVertices),
    GPUBufferUsage.VERTEX,
  );
  const floorVertexCount = wasm.floor_vertex_count();

  const videoVertices = new Float32Array(
    wasm.memory.buffer,
    wasm.video_vertex_ptr(),
    wasm.video_vertex_len(),
  );
  const videoVertexBuffer = uploadBuffer(
    device,
    new Float32Array(videoVertices),
    GPUBufferUsage.VERTEX,
  );
  const videoVertexCount = wasm.video_vertex_count();

  const frameVertices = new Float32Array(
    wasm.memory.buffer,
    wasm.tv_frame_vertex_ptr(),
    wasm.tv_frame_vertex_len(),
  );
  const frameVertexBuffer = uploadBuffer(
    device,
    new Float32Array(frameVertices),
    GPUBufferUsage.VERTEX,
  );
  const frameVertexCount = wasm.tv_frame_vertex_count();

  const archTextVertices = createArchBannerVertices();
  const archTextVertexBuffer = uploadBuffer(
    device,
    archTextVertices,
    GPUBufferUsage.VERTEX,
  );
  const archTextVertexCount = archTextVertices.length / 5;

  let boomboxVertexBuffer = null;
  let boomboxVertexCount = 0;
  let boomboxInfo = "not loaded";
  const tapeBaseQuaternion = new THREE.Quaternion().setFromEuler(
    TAPE_MODEL_CONFIG.rotation,
  );
  const tapeHeldYawQuaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0.0, 1.0, 0.0),
    TAPE_HOLD_YAW_OFFSET,
  );
  const tapeRuntime = {
    state: "unavailable",
    targetable: false,
    localVertices: null,
    worldVertices: null,
    vertexBuffer: null,
    vertexCount: 0,
    worldPosition: TAPE_MODEL_CONFIG.position.clone(),
    worldQuaternion: tapeBaseQuaternion.clone(),
    pickupAnchorLocal: new THREE.Vector3(0.0, 0.0, 0.0),
  };
  let tapeModelInfo = "not loaded";
  let playerModelVertexBuffer = null;
  let playerModelVertexCount = 0;
  let playerModelInfo = "not loaded";

  try {
    const boomboxMesh = await loadStaticModelVertices({
      loader: new FBXLoader(),
      ...BOOMBOX_MODEL_CONFIG,
    });
    boomboxVertexBuffer = uploadBuffer(
      device,
      boomboxMesh.vertices,
      GPUBufferUsage.VERTEX,
    );
    boomboxVertexCount = boomboxMesh.vertices.length / 3;
    boomboxInfo = `${boomboxVertexCount} verts scale=${boomboxMesh.scale.toFixed(4)} raw=${boomboxMesh.maxDim.toFixed(2)}`;
  } catch (error) {
    console.error("BoomBox.fbx load failed:", error);
    status(`BoomBox load failed: ${error.message}`);
    boomboxInfo = "load failed";
  }

  try {
    const tapeModelMesh = await loadModelMesh({
      loader: new GLTFLoader(),
      ...TAPE_MODEL_CONFIG,
    });
    tapeRuntime.localVertices = tapeModelMesh.vertices;
    tapeRuntime.worldVertices = bakeModelVertices(
      tapeModelMesh.vertices,
      tapeRuntime.worldPosition,
      TAPE_MODEL_CONFIG.rotation,
    );
    tapeRuntime.vertexBuffer = createWritableVertexBuffer(
      device,
      tapeRuntime.worldVertices,
    );
    tapeRuntime.vertexCount = tapeModelMesh.vertices.length / 3;
    tapeRuntime.pickupAnchorLocal.copy(
      tapeModelMesh.bounds.getCenter(new THREE.Vector3()),
    );
    tapeRuntime.state = "world";
    tapeModelInfo = `${tapeRuntime.vertexCount} verts scale=${tapeModelMesh.scale.toFixed(4)} raw=${tapeModelMesh.maxDim.toFixed(2)}`;
  } catch (error) {
    console.error("tape.glb load failed:", error);
    status(`tape.glb load failed: ${error.message}`);
    tapeRuntime.state = "load failed";
    tapeModelInfo = "load failed";
  }

  try {
    const playerModelMesh = await loadStaticModelVertices({
      loader: new GLTFLoader(),
      ...PLAYER_MODEL_CONFIG,
    });
    playerModelVertexBuffer = uploadBuffer(
      device,
      playerModelMesh.vertices,
      GPUBufferUsage.VERTEX,
    );
    playerModelVertexCount = playerModelMesh.vertices.length / 3;
    playerModelInfo = `${playerModelVertexCount} verts scale=${playerModelMesh.scale.toFixed(4)} raw=${playerModelMesh.maxDim.toFixed(2)}`;
  } catch (error) {
    console.error("player.glb load failed:", error);
    status(`player.glb load failed: ${error.message}`);
    playerModelInfo = "load failed";
  }

  const cameraBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const cameraValues = new Float32Array(16);
  const floorCameraBindGroup = device.createBindGroup({
    layout: floorPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
  const floorTextures = createWoodFloorTextures(device);
  const floorSampler = device.createSampler({
    addressModeU: "repeat",
    addressModeV: "repeat",
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
  });
  const floorMaterialValues = new Float32Array([
    // uv_scale.x, uv_scale.y, normal_strength, roughness_bias, tint.r, tint.g, tint.b, pad
    3.0, 3.0, 0.85, -0.05, 1.05, 0.95, 0.85, 0.0,
  ]);
  const floorMaterialBuffer = device.createBuffer({
    size: floorMaterialValues.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(floorMaterialBuffer, 0, floorMaterialValues);
  const floorMaterialBindGroup = device.createBindGroup({
    layout: floorPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: floorSampler },
      { binding: 1, resource: floorTextures.albedoTexture.createView() },
      { binding: 2, resource: floorTextures.normalTexture.createView() },
      { binding: 3, resource: floorTextures.roughnessTexture.createView() },
      { binding: 4, resource: { buffer: floorMaterialBuffer } },
    ],
  });
  const videoCameraBindGroup = device.createBindGroup({
    layout: videoPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
  const frameCameraBindGroup = device.createBindGroup({
    layout: framePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
  const boomboxCameraBindGroup = device.createBindGroup({
    layout: boomboxPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
  const archTextCameraBindGroup = device.createBindGroup({
    layout: archTextPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
  const videoSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });
  const archTextTexture = createArchTextTexture(device);
  const archTextSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });
  const archTextBindGroup = device.createBindGroup({
    layout: archTextPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: archTextSampler },
      { binding: 1, resource: archTextTexture.createView() },
    ],
  });

  const pressed = new Set();
  let lastKeyEvent = "none";
  let tapePickupQueued = false;
  let tapeDropQueued = false;
  let tapeActionQueued = false;
  let vcrNearby = false;
  const toVcr = new THREE.Vector3();
  let lookDeltaX = 0;
  let lookDeltaY = 0;
  let previousTime = performance.now();
  let depthTexture = null;
  const cameraPosition = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const cameraBackward = new THREE.Vector3();
  const cameraQuaternion = new THREE.Quaternion();
  const tapeHeldQuaternion = new THREE.Quaternion();
  const tapeHeldPosition = new THREE.Vector3();
  const tapePickupPoint = new THREE.Vector3();
  const toTape = new THREE.Vector3();
  const cameraBasisMatrix = new THREE.Matrix4();

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    depthTexture?.destroy();
    depthTexture = createDepthTexture(device, width, height);
    wasm.world_resize(width, height);
  }

  window.addEventListener("resize", resize);
  document.addEventListener("keydown", (event) => {
    lastKeyEvent = `down:${event.code}`;
    pressed.add(event.code);
    if (event.code === "KeyF" && !event.repeat) {
      tapeActionQueued = true;
    }
  });
  document.addEventListener("keyup", (event) => {
    lastKeyEvent = `up:${event.code}`;
    pressed.delete(event.code);
  });
  canvas.addEventListener("click", () => {
    canvas.requestPointerLock();
    playButton.blur();
    pauseButton.blur();
  });
  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement !== canvas) return;
    lookDeltaX += event.movementX;
    lookDeltaY += -event.movementY;
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
      status("Pointer locked. WASD/EQ move, mouse look.");
    } else {
      status("Pointer unlocked. Click canvas or Lock Cursor.");
    }
  });

  wasm.world_init(canvas.clientWidth || 1, canvas.clientHeight || 1);
  resize();
  status("Ready. WASD/EQ move. Click canvas or Lock Cursor for mouse look.");

  function frame(now) {
    try {
      const dt = (now - previousTime) / 1000;
      previousTime = now;
      resize();

      wasm.world_update(
        dt,
        axis(pressed.has("KeyW"), pressed.has("KeyS")),
        axis(pressed.has("KeyD"), pressed.has("KeyA")),
        axis(pressed.has("KeyE"), pressed.has("KeyQ")),
        lookDeltaX,
        lookDeltaY,
        pressed.has("ShiftLeft") || pressed.has("ShiftRight") ? 1 : 0,
      );
      lookDeltaX = 0;
      lookDeltaY = 0;

      cameraValues.set(
        new Float32Array(wasm.memory.buffer, wasm.camera_matrix_ptr(), 16),
      );
      device.queue.writeBuffer(cameraBuffer, 0, cameraValues);

      const pos = new Float32Array(
        wasm.memory.buffer,
        wasm.camera_position_ptr(),
        3,
      );
      const forward = new Float32Array(
        wasm.memory.buffer,
        wasm.camera_forward_ptr(),
        3,
      );
      const right = new Float32Array(
        wasm.memory.buffer,
        wasm.camera_right_ptr(),
        3,
      );
      const up = new Float32Array(wasm.memory.buffer, wasm.camera_up_ptr(), 3);
      cameraPosition.fromArray(pos);
      cameraForward.fromArray(forward).normalize();
      cameraRight.fromArray(right).normalize();
      cameraUp.fromArray(up).normalize();
      const activeVideoElement = getMountedVideoElement?.();
      if (activeVideoElement instanceof HTMLVideoElement && activeVideoElement !== videoElement) {
        videoElement = activeVideoElement;
        videoElement.muted = false;
        videoElement.playsInline = true;
        videoElement.loop = true;
      }

      // -- VCR proximity detection --
      toVcr.subVectors(VCR_POSITION, cameraPosition);
      const vcrDistance = toVcr.length();
      vcrNearby = false;
      if (vcrDistance > 0.0001) {
        const vcrFacing = toVcr.normalize().dot(cameraForward);
        vcrNearby =
          vcrDistance <= VCR_INSERT_RADIUS &&
          vcrFacing >= VCR_INSERT_DOT_THRESHOLD;
      }

      // -- Handle F key action based on current state --
      if (tapeActionQueued) {
        if (tapeRuntime.state === "held" && vcrNearby) {
          // INSERT tape into VCR: hide tape mesh, load video, play
          tapeRuntime.state = "inserted";
          tapeRuntime.targetable = false;
          tapeInserted = true;

          // Move tape vertices off-screen so it disappears
          if (tapeRuntime.worldVertices) {
            tapeRuntime.worldVertices.fill(0);
            device.queue.writeBuffer(
              tapeRuntime.vertexBuffer,
              0,
              tapeRuntime.worldVertices,
            );
          }

          const activeVid = getMountedVideoElement?.() ?? videoElement;
          if (activeVid instanceof HTMLVideoElement) {
            videoElement = activeVid;
          }
          changeVideoSource(
            videoElement,
            TAPE_VIDEO_DATA.src,
            TAPE_VIDEO_DATA.poster,
          );
          videoRenderEnabled = true;
          status(`Now playing: ${TAPE_VIDEO_DATA.title}`);

        } else if (tapeRuntime.state === "inserted" && vcrNearby) {
          // EJECT tape from VCR: stop video, give tape back to hand
          tapeRuntime.state = "held";
          tapeInserted = false;

          videoElement.pause();
          videoElement.removeAttribute("src");
          videoElement.load();
          status("Tape ejected.");

        } else if (tapeRuntime.state === "held" && !vcrNearby) {
          // DROP tape on ground
          const dropForward = new THREE.Vector3(
            cameraForward.x,
            0.0,
            cameraForward.z,
          ).normalize();
          const dropPos = new THREE.Vector3()
            .copy(cameraPosition)
            .addScaledVector(dropForward, TAPE_DROP_DISTANCE);
          dropPos.y = 0.0;

          tapeRuntime.worldPosition.copy(dropPos);
          tapeRuntime.worldQuaternion.copy(tapeBaseQuaternion);

          const dropVertices = bakeModelVertices(
            tapeRuntime.localVertices,
            tapeRuntime.worldPosition,
            TAPE_MODEL_CONFIG.rotation,
          );
          tapeRuntime.worldVertices.set(dropVertices);
          device.queue.writeBuffer(
            tapeRuntime.vertexBuffer,
            0,
            tapeRuntime.worldVertices,
          );

          tapeRuntime.state = "world";
          tapeRuntime.targetable = false;

        } else if (tapeRuntime.state === "world") {
          // PICKUP tape from ground (handled below via targetable check)
          tapePickupQueued = true;
        }
      }
      tapeActionQueued = false;

      // -- Tape pickup targeting (when tape is on the ground) --
      tapeRuntime.targetable = false;
      if (tapeRuntime.state === "world") {
        tapePickupPoint
          .copy(tapeRuntime.pickupAnchorLocal)
          .applyQuaternion(tapeRuntime.worldQuaternion)
          .add(tapeRuntime.worldPosition);
        toTape.subVectors(tapePickupPoint, cameraPosition);
        const tapeDistance = toTape.length();
        if (tapeDistance > 0.0001) {
          const tapeFacing = toTape.normalize().dot(cameraForward);
          tapeRuntime.targetable =
            tapeDistance <= TAPE_PICKUP_RADIUS &&
            tapeFacing >= TAPE_PICKUP_DOT_THRESHOLD;
        }
        if (tapePickupQueued && tapeRuntime.targetable) {
          tapeRuntime.state = "held";
          tapeRuntime.targetable = false;
        }
      }
      tapePickupQueued = false;

      // -- Tape held: attach to hand --
      if (
        tapeRuntime.state === "held" &&
        tapeRuntime.localVertices &&
        tapeRuntime.worldVertices &&
        tapeRuntime.vertexBuffer
      ) {
        tapeHeldPosition
          .copy(cameraPosition)
          .addScaledVector(cameraRight, TAPE_HOLD_OFFSET.right)
          .addScaledVector(cameraUp, TAPE_HOLD_OFFSET.up)
          .addScaledVector(cameraForward, TAPE_HOLD_OFFSET.forward);
        cameraBackward.copy(cameraForward).negate();
        cameraBasisMatrix.makeBasis(cameraRight, cameraUp, cameraBackward);
        cameraQuaternion.setFromRotationMatrix(cameraBasisMatrix);
        tapeHeldQuaternion
          .copy(cameraQuaternion)
          .multiply(tapeHeldYawQuaternion)
          .multiply(tapeBaseQuaternion);
        transformModelVertices(
          tapeRuntime.localVertices,
          tapeHeldPosition,
          tapeHeldQuaternion,
          tapeRuntime.worldVertices,
        );
        device.queue.writeBuffer(
          tapeRuntime.vertexBuffer,
          0,
          tapeRuntime.worldVertices,
        );
      }

      // -- Status messages --
      if (tapeRuntime.state === "inserted") {
        if (vcrNearby) {
          setContextStatus("Press F to eject tape.");
        } else {
          setContextStatus(`Playing: ${TAPE_VIDEO_DATA.title}`);
        }
      } else if (tapeRuntime.state === "held") {
        if (vcrNearby) {
          setContextStatus("Press F to insert tape into player.");
        } else {
          setContextStatus("Tape in hand. Press F to drop.");
        }
      } else if (tapeRuntime.targetable) {
        setContextStatus("Press F to pick up tape.");
      } else {
        setContextStatus("");
      }

      if (crosshairEl) {
        crosshairEl.dataset.state =
          tapeRuntime.state === "held"
            ? "held"
            : tapeRuntime.state === "inserted"
              ? "held"
              : tapeRuntime.targetable || (vcrNearby && tapeRuntime.state === "held")
                ? "targetable"
                : "idle";
      }

      const keyList = Array.from(pressed).join(", ");
      const locked = document.pointerLockElement === canvas ? "yes" : "no";
      const videoState = videoElement.paused ? "paused" : "playing";
      telemetryEl.textContent =
        `camera: (${pos[0].toFixed(2)}, ${pos[1].toFixed(2)}, ${pos[2].toFixed(2)})\n` +
        `pointerLock: ${locked}\n` +
        `keys: ${keyList || "none"}\n` +
        `lastKey: ${lastKeyEvent}\n` +
        `video: ${videoState}${videoRenderError ? ` (${videoRenderError})` : ""}\n` +
        `boombox: ${boomboxInfo}\n` +
        `tape: ${tapeRuntime.state}${tapeRuntime.targetable ? " targetable" : ""}\n` +
        `tape.glb: ${tapeModelInfo}\n` +
        `player.glb: ${playerModelInfo}`;

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.58, g: 0.72, b: 0.87, a: 1.0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthClearValue: 1.0,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });

      pass.setPipeline(floorPipeline);
      pass.setBindGroup(0, floorCameraBindGroup);
      pass.setBindGroup(1, floorMaterialBindGroup);
      pass.setVertexBuffer(0, floorVertexBuffer);
      pass.draw(floorVertexCount, 1, 0, 0);

      pass.setPipeline(framePipeline);
      pass.setBindGroup(0, frameCameraBindGroup);
      pass.setVertexBuffer(0, frameVertexBuffer);
      pass.draw(frameVertexCount, 1, 0, 0);

      if (boomboxVertexBuffer && boomboxVertexCount > 0) {
        pass.setPipeline(boomboxPipeline);
        pass.setBindGroup(0, boomboxCameraBindGroup);
        pass.setVertexBuffer(0, boomboxVertexBuffer);
        pass.draw(boomboxVertexCount, 1, 0, 0);
      }

      if (tapeRuntime.vertexBuffer && tapeRuntime.vertexCount > 0) {
        pass.setPipeline(boomboxPipeline);
        pass.setBindGroup(0, boomboxCameraBindGroup);
        pass.setVertexBuffer(0, tapeRuntime.vertexBuffer);
        pass.draw(tapeRuntime.vertexCount, 1, 0, 0);
      }

      if (playerModelVertexBuffer && playerModelVertexCount > 0) {
        pass.setPipeline(boomboxPipeline);
        pass.setBindGroup(0, boomboxCameraBindGroup);
        pass.setVertexBuffer(0, playerModelVertexBuffer);
        pass.draw(playerModelVertexCount, 1, 0, 0);
      }

      pass.setPipeline(archTextPipeline);
      pass.setBindGroup(0, archTextCameraBindGroup);
      pass.setBindGroup(1, archTextBindGroup);
      pass.setVertexBuffer(0, archTextVertexBuffer);
      pass.draw(archTextVertexCount, 1, 0, 0);

      if (
        tapeInserted &&
        videoRenderEnabled &&
        videoElement.readyState >= 2 &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0 &&
        !videoElement.paused
      ) {
        try {
          const externalTexture = device.importExternalTexture({
            source: videoElement,
          });
          const videoBindGroup = device.createBindGroup({
            layout: videoPipeline.getBindGroupLayout(1),
            entries: [
              { binding: 0, resource: videoSampler },
              { binding: 1, resource: externalTexture },
            ],
          });
          pass.setPipeline(videoPipeline);
          pass.setBindGroup(0, videoCameraBindGroup);
          pass.setBindGroup(1, videoBindGroup);
          pass.setVertexBuffer(0, videoVertexBuffer);
          pass.draw(videoVertexCount, 1, 0, 0);
          videoRenderError = "";
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("back resource")) {
            videoRenderError = "waiting for video frame";
          } else {
            videoRenderEnabled = false;
            videoRenderError = "video texture import failed";
            status(`Video texture disabled: ${message}`);
          }
        }
      }

      pass.end();
      device.queue.submit([encoder.finish()]);
    } catch (error) {
      console.error("Frame error:", error);
      status(`Frame error: ${error.message}`);
    } finally {
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

main().catch((error) => {
  statusEl.textContent = `Error: ${error.message}`;
  console.error(error);
});
