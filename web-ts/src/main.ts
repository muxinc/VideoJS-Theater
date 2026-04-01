import {
  mountHiddenVideoJsPlayer,
  changeVideoSource,
} from "./videojs-player-host";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  ARCH_TEXT_SHADER_CODE,
  CURTAIN_SHADER_CODE,
  CURTAIN_VERTICES,
  FLOOR_VERTICES,
  MESH_SHADER_CODE,
  POSTER_0_VERTICES,
  POSTER_1_VERTICES,
  POSTER_2_VERTICES,
  POSTER_SHADER_CODE,
  RPOSTER_0_VERTICES,
  RPOSTER_1_VERTICES,
  RPOSTER_2_VERTICES,
  SEAT_SHADER_CODE,
  SEAT_VERTICES,
  TV_FRAME_SHADER_CODE,
  TV_FRAME_VERTICES,
  VIDEO_SHADER_CODE,
  VIDEO_VERTICES,
  WALL_SHADER_CODE,
  WALL_VERTICES,
  WorldState,
} from "./world";
import "./style.css";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} element`);
  }
  return element as T;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const canvas = requireElement<HTMLCanvasElement>("scene");
const statusEl = requireElement<HTMLElement>("status");
const crosshairEl = requireElement<HTMLElement>("crosshair");
const cursorLockButton = requireElement<HTMLButtonElement>("cursor-lock");
const playButton = requireElement<HTMLButtonElement>("video-play");
const pauseButton = requireElement<HTMLButtonElement>("video-pause");
const lightsButton = requireElement<HTMLButtonElement>("lights-toggle");

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

const VIDEO_SCREEN_RECT = Object.freeze({
  left: -3.4,
  right: 3.4,
  top: 3.2,
  bottom: 0.9,
  z: -9.79,
});

const PROJECTOR_CONFIG = Object.freeze({
  bodyMin: new THREE.Vector3(-0.92, 5.24, 10.95),
  bodyMax: new THREE.Vector3(0.92, 5.7, 11.78),
  neckMin: new THREE.Vector3(-0.14, 5.7, 11.14),
  neckMax: new THREE.Vector3(0.14, 5.92, 11.46),
  mountMin: new THREE.Vector3(-0.56, 5.92, 11.0),
  mountMax: new THREE.Vector3(0.56, 6.0, 11.6),
  lensMin: new THREE.Vector3(-0.24, 5.34, 10.58),
  lensMax: new THREE.Vector3(0.24, 5.58, 10.95),
  lensCenter: new THREE.Vector3(0.0, 5.46, 10.58),
  apertureHalfWidth: 0.16,
  apertureHalfHeight: 0.1,
  targetInsetX: 0.32,
  targetInsetY: 0.18,
  beamTargetZ: VIDEO_SCREEN_RECT.z + 0.03,
});

if (!navigator.gpu) {
  statusEl.textContent = "WebGPU is not available in this browser.";
  throw new Error("WebGPU unavailable");
}

let baseStatusMessage = "Booting...";
let contextualStatusMessage = "";

async function loadImageTexture(device, url) {
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height, 1],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [
    bitmap.width,
    bitmap.height,
  ]);
  return texture;
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

  let spec_power = mix(64.0, 12.0, roughness);
  let specular = pow(max(dot(normal_ws, half_vec), 0.0), spec_power) * (1.0 - roughness) * 0.06;
  let hemi = clamp(normal_ws.y * 0.5 + 0.5, 0.0, 1.0);
  let ambient = mix(vec3<f32>(0.02, 0.015, 0.01), vec3<f32>(0.06, 0.05, 0.04), hemi);

  var color = albedo * (0.08 + 0.35 * ndotl) + albedo * ambient * 0.4 + vec3<f32>(specular);

  // TV screen glow: soft light projected onto floor from screen center
  let screen_center = vec3<f32>(0.0, 2.0, -9.8);
  let to_screen = vec3<f32>(in.uv.x / floor_material.uv_scale.x, 0.0, in.uv.y / floor_material.uv_scale.y) - screen_center;
  let screen_dist = length(to_screen);
  let glow_strength = clamp(1.0 / (1.0 + screen_dist * screen_dist * 0.08), 0.0, 1.0);
  let screen_glow = vec3<f32>(0.15, 0.18, 0.25) * glow_strength * 0.3;
  color = color + screen_glow;

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
    value +=
      amplitude * smoothNoise(x * frequency, y * frequency, seed + i * 31.7);
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
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;
      const macroNoise = fbm(u * 2.0, v * 2.0, 12.7, 4);
      const tuftNoise = fbm(u * 14.0, v * 14.0, 29.1, 5);
      const fiberNoise = smoothNoise(px * 0.42, py * 0.42, 53.8);
      const fleck = smoothNoise(px * 1.25, py * 1.25, 77.4);
      const nap = 0.5 + 0.5 * Math.sin((u + v) * 32.0 + macroNoise * 4.5);
      const h =
        macroNoise * 0.28 + tuftNoise * 0.34 + fiberNoise * 0.24 + nap * 0.14;
      heightData[py * size + px] = h;
      const idx = py * size + px;
      const idx4 = idx * 4;
      const seafoamShift = macroNoise * 18 + tuftNoise * 14 + nap * 10;
      const coolShift = fiberNoise * 10 + fleck * 6;
      const r = 126 + seafoamShift * 0.55 - coolShift * 0.15;
      const g = 205 + seafoamShift * 0.9 + coolShift * 0.25;
      const b = 183 + seafoamShift * 0.7 + coolShift * 0.45;

      albedoData[idx4 + 0] = Math.max(0, Math.min(255, Math.round(r)));
      albedoData[idx4 + 1] = Math.max(0, Math.min(255, Math.round(g)));
      albedoData[idx4 + 2] = Math.max(0, Math.min(255, Math.round(b)));
      albedoData[idx4 + 3] = 255;
    }
  }

  for (let py = 0; py < size; py++) {
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

      const slopeX = hRight - hLeft;
      const slopeY = hUp - hDown;
      const nx = -slopeX * 0.95;
      const ny = -slopeY * 0.95;
      const nz = 1.0;
      const normalLen = Math.hypot(nx, ny, nz) || 1.0;
      normalData[idx4 + 0] = Math.round(((nx / normalLen) * 0.5 + 0.5) * 255);
      normalData[idx4 + 1] = Math.round(((ny / normalLen) * 0.5 + 0.5) * 255);
      normalData[idx4 + 2] = Math.round(((nz / normalLen) * 0.5 + 0.5) * 255);
      normalData[idx4 + 3] = 255;

      const roughness = 0.87 + h * 0.08;
      roughnessData[idx] = Math.round(
        Math.max(0, Math.min(1, roughness)) * 255,
      );
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

function appendCuboidVertices(vertices, min, max) {
  const x0 = min.x;
  const y0 = min.y;
  const z0 = min.z;
  const x1 = max.x;
  const y1 = max.y;
  const z1 = max.z;

  vertices.push(
    x0,
    y1,
    z1,
    x1,
    y1,
    z1,
    x1,
    y0,
    z1,
    x0,
    y1,
    z1,
    x1,
    y0,
    z1,
    x0,
    y0,
    z1,

    x1,
    y1,
    z0,
    x0,
    y1,
    z0,
    x0,
    y0,
    z0,
    x1,
    y1,
    z0,
    x0,
    y0,
    z0,
    x1,
    y0,
    z0,

    x0,
    y1,
    z0,
    x0,
    y1,
    z1,
    x0,
    y0,
    z1,
    x0,
    y1,
    z0,
    x0,
    y0,
    z1,
    x0,
    y0,
    z0,

    x1,
    y1,
    z1,
    x1,
    y1,
    z0,
    x1,
    y0,
    z0,
    x1,
    y1,
    z1,
    x1,
    y0,
    z0,
    x1,
    y0,
    z1,

    x0,
    y1,
    z0,
    x1,
    y1,
    z0,
    x1,
    y1,
    z1,
    x0,
    y1,
    z0,
    x1,
    y1,
    z1,
    x0,
    y1,
    z1,

    x0,
    y0,
    z1,
    x1,
    y0,
    z1,
    x1,
    y0,
    z0,
    x0,
    y0,
    z1,
    x1,
    y0,
    z0,
    x0,
    y0,
    z0,
  );
}

function createProjectorVertices() {
  const vertices = [];
  appendCuboidVertices(
    vertices,
    PROJECTOR_CONFIG.mountMin,
    PROJECTOR_CONFIG.mountMax,
  );
  appendCuboidVertices(
    vertices,
    PROJECTOR_CONFIG.neckMin,
    PROJECTOR_CONFIG.neckMax,
  );
  appendCuboidVertices(
    vertices,
    PROJECTOR_CONFIG.bodyMin,
    PROJECTOR_CONFIG.bodyMax,
  );
  appendCuboidVertices(
    vertices,
    PROJECTOR_CONFIG.lensMin,
    PROJECTOR_CONFIG.lensMax,
  );
  return new Float32Array(vertices);
}

function appendBeamQuad(vertices, a, b, c, d) {
  vertices.push(
    a.x,
    a.y,
    a.z,
    0.0,
    0.0,
    b.x,
    b.y,
    b.z,
    1.0,
    0.0,
    c.x,
    c.y,
    c.z,
    1.0,
    1.0,
    a.x,
    a.y,
    a.z,
    0.0,
    0.0,
    c.x,
    c.y,
    c.z,
    1.0,
    1.0,
    d.x,
    d.y,
    d.z,
    0.0,
    1.0,
  );
}

function createProjectorBeamVertices() {
  const source = PROJECTOR_CONFIG.lensCenter;
  const sourceCorners = [
    new THREE.Vector3(
      source.x - PROJECTOR_CONFIG.apertureHalfWidth,
      source.y + PROJECTOR_CONFIG.apertureHalfHeight,
      source.z,
    ),
    new THREE.Vector3(
      source.x + PROJECTOR_CONFIG.apertureHalfWidth,
      source.y + PROJECTOR_CONFIG.apertureHalfHeight,
      source.z,
    ),
    new THREE.Vector3(
      source.x + PROJECTOR_CONFIG.apertureHalfWidth,
      source.y - PROJECTOR_CONFIG.apertureHalfHeight,
      source.z,
    ),
    new THREE.Vector3(
      source.x - PROJECTOR_CONFIG.apertureHalfWidth,
      source.y - PROJECTOR_CONFIG.apertureHalfHeight,
      source.z,
    ),
  ];
  const targetCorners = [
    new THREE.Vector3(
      VIDEO_SCREEN_RECT.left + PROJECTOR_CONFIG.targetInsetX,
      VIDEO_SCREEN_RECT.top - PROJECTOR_CONFIG.targetInsetY,
      PROJECTOR_CONFIG.beamTargetZ,
    ),
    new THREE.Vector3(
      VIDEO_SCREEN_RECT.right - PROJECTOR_CONFIG.targetInsetX,
      VIDEO_SCREEN_RECT.top - PROJECTOR_CONFIG.targetInsetY,
      PROJECTOR_CONFIG.beamTargetZ,
    ),
    new THREE.Vector3(
      VIDEO_SCREEN_RECT.right - PROJECTOR_CONFIG.targetInsetX,
      VIDEO_SCREEN_RECT.bottom + PROJECTOR_CONFIG.targetInsetY,
      PROJECTOR_CONFIG.beamTargetZ,
    ),
    new THREE.Vector3(
      VIDEO_SCREEN_RECT.left + PROJECTOR_CONFIG.targetInsetX,
      VIDEO_SCREEN_RECT.bottom + PROJECTOR_CONFIG.targetInsetY,
      PROJECTOR_CONFIG.beamTargetZ,
    ),
  ];

  const vertices = [];
  for (let i = 0; i < 4; i += 1) {
    const next = (i + 1) % 4;
    appendBeamQuad(
      vertices,
      sourceCorners[i],
      sourceCorners[next],
      targetCorners[next],
      targetCorners[i],
    );
  }

  return new Float32Array(vertices);
}

function getProjectorBeamShaderCode() {
  return /* wgsl */ `
struct Camera {
  view_proj: mat4x4<f32>,
};

struct ProjectorLight {
  intensity: f32,
  _pad0: vec3<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> projector_light: ProjectorLight;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) world_pos: vec3<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
  var out: VsOut;
  out.uv = in.uv;
  out.world_pos = in.position;
  out.clip_position = camera.view_proj * vec4<f32>(in.position, 1.0);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let edge_fade = smoothstep(0.0, 0.18, in.uv.x) * (1.0 - smoothstep(0.82, 1.0, in.uv.x));
  let near_fade = smoothstep(0.02, 0.18, in.uv.y);
  let far_fade = 1.0 - smoothstep(0.7, 1.0, in.uv.y);
  let shimmer = 0.88 + 0.12 * sin(in.world_pos.z * 0.55 + in.world_pos.y * 4.0);
  let alpha = projector_light.intensity * edge_fade * near_fade * (0.45 + far_fade * 0.55) * shimmer * 0.18;
  let color = vec3<f32>(0.72, 0.8, 1.0) * (0.35 + near_fade * 0.65);
  return vec4<f32>(color, alpha);
}
`;
}

function status(message: string): void {
  baseStatusMessage = message;
  renderStatus();
}

function setContextStatus(message: string): void {
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

async function loadModelMesh({
  loader,
  url,
  targetMaxDim,
  floorOffset = 0.03,
}) {
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

function collectModelVertices(root: THREE.Object3D): Float32Array {
  const vertices: number[] = [];
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

function bakeModelVertices(
  localVertices: Float32Array,
  position: THREE.Vector3,
  rotation: THREE.Euler,
): Float32Array {
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);
  return transformModelVertices(localVertices, position, quaternion);
}

function transformModelVertices(
  localVertices: Float32Array,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  target?: Float32Array,
): Float32Array {
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

function createWritableVertexBuffer(
  device: GPUDevice,
  values: Float32Array,
): GPUBuffer {
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
  let tapeInserted = false;
  let lightsOn = false;
  const insertTapeMessage =
    "Turn the lights on and put the VHS tape in the VCR player to play the video.";

  playButton.addEventListener("click", () => {
    if (!tapeInserted) {
      status(insertTapeMessage);
      return;
    }
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
  lightsButton.addEventListener("click", () => {
    lightsOn = !lightsOn;
    lightsButton.textContent = lightsOn ? "Lights Off" : "Lights On";
  });

  const world = new WorldState();
  const floorShaderCode = getWoodFloorShaderCode();
  const frameShaderCode = TV_FRAME_SHADER_CODE;
  const boomboxShaderCode = MESH_SHADER_CODE;
  const archTextShaderCode = ARCH_TEXT_SHADER_CODE;
  const videoShaderCode = VIDEO_SHADER_CODE;
  const wallShaderCode = WALL_SHADER_CODE;
  const curtainShaderCode = CURTAIN_SHADER_CODE;
  const seatShaderCode = SEAT_SHADER_CODE;
  const posterShaderCode = POSTER_SHADER_CODE;
  const projectorBeamShaderCode = getProjectorBeamShaderCode();

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter available");
  const device = await adapter.requestDevice();
  device.addEventListener("uncapturederror", (event) => {
    const message = event.error?.message || "Unknown WebGPU error";
    console.error("Uncaptured WebGPU error:", event.error);
    if (
      !tapeInserted &&
      message.includes(
        "Destination texture needs to have CopyDst and RenderAttachment usage",
      )
    ) {
      status(insertTapeMessage);
      return;
    }
    status(`WebGPU error: ${message}`);
  });
  const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
  if (!context) {
    throw new Error("Could not acquire a WebGPU canvas context");
  }
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

  function createSimplePipeline(shaderCode) {
    const module = device.createShaderModule({ code: shaderCode });
    return device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
  }

  const wallPipeline = createSimplePipeline(wallShaderCode);
  const curtainPipeline = createSimplePipeline(curtainShaderCode);
  const seatPipeline = createSimplePipeline(seatShaderCode);

  const projectorBeamModule = device.createShaderModule({
    code: projectorBeamShaderCode,
  });
  const projectorBeamPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: projectorBeamModule,
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
      module: projectorBeamModule,
      entryPoint: "fs_main",
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one",
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
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less",
    },
  });

  const posterModule = device.createShaderModule({ code: posterShaderCode });
  const posterPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: posterModule,
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
      module: posterModule,
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const floorVertexBuffer = uploadBuffer(
    device,
    FLOOR_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const floorVertexCount = FLOOR_VERTICES.length / 3;

  const videoVertexBuffer = uploadBuffer(
    device,
    VIDEO_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const videoVertexCount = VIDEO_VERTICES.length / 5;

  const frameVertexBuffer = uploadBuffer(
    device,
    TV_FRAME_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const frameVertexCount = TV_FRAME_VERTICES.length / 3;

  const archTextVertices = createArchBannerVertices();
  const archTextVertexBuffer = uploadBuffer(
    device,
    archTextVertices,
    GPUBufferUsage.VERTEX,
  );
  const archTextVertexCount = archTextVertices.length / 5;

  // Wall vertices
  const wallVertexBuffer = uploadBuffer(
    device,
    WALL_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const wallVertexCount = WALL_VERTICES.length / 3;

  // Curtain vertices
  const curtainVertexBuffer = uploadBuffer(
    device,
    CURTAIN_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const curtainVertexCount = CURTAIN_VERTICES.length / 3;

  // Seat vertices
  const seatVertexBuffer = uploadBuffer(
    device,
    SEAT_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const seatVertexCount = SEAT_VERTICES.length / 3;

  const projectorVertices = createProjectorVertices();
  const projectorVertexBuffer = uploadBuffer(
    device,
    projectorVertices,
    GPUBufferUsage.VERTEX,
  );
  const projectorVertexCount = projectorVertices.length / 3;

  const projectorBeamVertices = createProjectorBeamVertices();
  const projectorBeamVertexBuffer = uploadBuffer(
    device,
    projectorBeamVertices,
    GPUBufferUsage.VERTEX,
  );
  const projectorBeamVertexCount = projectorBeamVertices.length / 5;

  // Poster vertex buffers (5 floats per vert: pos3 + uv2)
  const poster0VertexBuffer = uploadBuffer(
    device,
    POSTER_0_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const poster1VertexBuffer = uploadBuffer(
    device,
    POSTER_1_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const poster2VertexBuffer = uploadBuffer(
    device,
    POSTER_2_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const posterVertexCount = 6; // 2 triangles per poster

  // Load left wall poster textures
  const [posterTex0, posterTex1, posterTex2] = await Promise.all([
    loadImageTexture(device, "./twoOldPeople.png"),
    loadImageTexture(device, "./catzilla.png"),
    loadImageTexture(device, "./bunny.jpg"),
  ]);

  // Right wall poster vertex buffers
  const rposter0VertexBuffer = uploadBuffer(
    device,
    RPOSTER_0_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const rposter1VertexBuffer = uploadBuffer(
    device,
    RPOSTER_1_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const rposter2VertexBuffer = uploadBuffer(
    device,
    RPOSTER_2_VERTICES,
    GPUBufferUsage.VERTEX,
  );

  // Load right wall poster textures
  const [rposterTex0, rposterTex1, rposterTex2] = await Promise.all([
    loadImageTexture(device, "./water.png"),
    loadImageTexture(device, "./mediachrome.png"),
    loadImageTexture(device, "./muxrobots.png"),
  ]);

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
  let playerModelVertexBuffer = null;
  let playerModelVertexCount = 0;

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
  } catch (error) {
    console.error("tape.glb load failed:", error);
    status(`tape.glb load failed: ${getErrorMessage(error)}`);
    tapeRuntime.state = "load failed";
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
  } catch (error) {
    console.error("player.glb load failed:", error);
    status(`player.glb load failed: ${getErrorMessage(error)}`);
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
    3.2,
    3.2, 0.24, 0.18, 1.0, 1.0, 1.0, 0.0,
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
  const roomLightBuffer = device.createBuffer({
    size: 16, // f32 brightness + 12 bytes padding (min uniform size is 16)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const roomLightValues = new Float32Array([0.0, 0.0, 0.0, 0.0]);
  device.queue.writeBuffer(roomLightBuffer, 0, roomLightValues);

  const wallCameraBindGroup = device.createBindGroup({
    layout: wallPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: roomLightBuffer } },
    ],
  });
  const curtainCameraBindGroup = device.createBindGroup({
    layout: curtainPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: roomLightBuffer } },
    ],
  });
  const seatCameraBindGroup = device.createBindGroup({
    layout: seatPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: roomLightBuffer } },
    ],
  });
  const projectorLightBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const projectorLightValues = new Float32Array([0.0, 0.0, 0.0, 0.0]);
  device.queue.writeBuffer(projectorLightBuffer, 0, projectorLightValues);
  const projectorBeamBindGroup = device.createBindGroup({
    layout: projectorBeamPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: projectorLightBuffer } },
    ],
  });
  const posterCameraBindGroup = device.createBindGroup({
    layout: posterPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: roomLightBuffer } },
    ],
  });
  const posterSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });
  const posterBindGroup0 = device.createBindGroup({
    layout: posterPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: posterSampler },
      { binding: 1, resource: posterTex0.createView() },
    ],
  });
  const posterBindGroup1 = device.createBindGroup({
    layout: posterPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: posterSampler },
      { binding: 1, resource: posterTex1.createView() },
    ],
  });
  const posterBindGroup2 = device.createBindGroup({
    layout: posterPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: posterSampler },
      { binding: 1, resource: posterTex2.createView() },
    ],
  });
  const rposterBindGroup0 = device.createBindGroup({
    layout: posterPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: posterSampler },
      { binding: 1, resource: rposterTex0.createView() },
    ],
  });
  const rposterBindGroup1 = device.createBindGroup({
    layout: posterPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: posterSampler },
      { binding: 1, resource: rposterTex1.createView() },
    ],
  });
  const rposterBindGroup2 = device.createBindGroup({
    layout: posterPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: posterSampler },
      { binding: 1, resource: rposterTex2.createView() },
    ],
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

  function performTapeAction() {
    if (tapeRuntime.state === "held" && vcrNearby) {
      tapeRuntime.state = "inserted";
      tapeRuntime.targetable = false;
      tapeInserted = true;

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
      const playPromise = changeVideoSource(
        videoElement,
        TAPE_VIDEO_DATA.src,
        TAPE_VIDEO_DATA.poster,
      );
      if (playPromise) {
        playPromise.catch(() => {
          status(
            `Tape inserted. Press Play to start ${TAPE_VIDEO_DATA.title}.`,
          );
        });
      }
      videoRenderEnabled = true;
      status(`Now playing: ${TAPE_VIDEO_DATA.title}`);
      return true;
    }

    if (tapeRuntime.state === "inserted" && vcrNearby) {
      tapeRuntime.state = "held";
      tapeInserted = false;

      videoElement.pause();
      videoElement.removeAttribute("src");
      videoElement.load();
      status("Tape ejected.");
      return true;
    }

    if (tapeRuntime.state === "held" && !vcrNearby) {
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
      return true;
    }

    if (tapeRuntime.state === "world" && tapeRuntime.targetable) {
      tapeRuntime.state = "held";
      tapeRuntime.targetable = false;
      return true;
    }

    if (tapeRuntime.state === "world") {
      tapePickupQueued = true;
      return true;
    }

    return false;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    depthTexture?.destroy();
    depthTexture = createDepthTexture(device, width, height);
    world.resize(width, height);
  }

  window.addEventListener("resize", resize);
  document.addEventListener("keydown", (event) => {
    pressed.add(event.code);
    if (event.code === "KeyF" && !event.repeat) {
      if (!performTapeAction()) {
        tapeActionQueued = true;
      }
    }
  });
  document.addEventListener("keyup", (event) => {
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

  world.init(canvas.clientWidth || 1, canvas.clientHeight || 1);
  resize();
  status("Ready. WASD/EQ move. Click canvas or Lock Cursor for mouse look.");

  function frame(now) {
    try {
      const dt = (now - previousTime) / 1000;
      previousTime = now;
      resize();

      world.update(
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

      cameraValues.set(world.viewProj);
      device.queue.writeBuffer(cameraBuffer, 0, cameraValues);

      // Update room light brightness
      const targetBrightness = lightsOn ? 1.0 : 0.0;
      roomLightValues[0] = targetBrightness;
      device.queue.writeBuffer(roomLightBuffer, 0, roomLightValues);

      // Update floor material tint based on lights
      const lt = lightsOn ? 1.0 : 0.0;
      floorMaterialValues[4] = 1.0 + lt * 3.0; // tint.r
      floorMaterialValues[5] = 1.0 + lt * 2.8; // tint.g
      floorMaterialValues[6] = 1.0 + lt * 2.5; // tint.b
      floorMaterialValues[2] = lightsOn ? 1.0 : 0.4; // normal_strength
      device.queue.writeBuffer(floorMaterialBuffer, 0, floorMaterialValues);

      cameraPosition.fromArray(world.cameraPosition);
      cameraForward.fromArray(world.cameraForward).normalize();
      cameraRight.fromArray(world.cameraRight).normalize();
      cameraUp.fromArray(world.cameraUp).normalize();
      const activeVideoElement = getMountedVideoElement?.();
      if (
        activeVideoElement instanceof HTMLVideoElement &&
        activeVideoElement !== videoElement
      ) {
        videoElement = activeVideoElement;
        videoElement.muted = false;
        videoElement.playsInline = true;
        videoElement.loop = true;
      }
      const projectorActive =
        tapeInserted &&
        videoElement.readyState >= 2 &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0 &&
        !videoElement.paused;
      projectorLightValues[0] = projectorActive ? 1.0 : 0.0;
      device.queue.writeBuffer(projectorLightBuffer, 0, projectorLightValues);

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
        performTapeAction();
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
              : tapeRuntime.targetable ||
                  (vcrNearby && tapeRuntime.state === "held")
                ? "targetable"
                : "idle";
      }

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: lightsOn
              ? { r: 0.25, g: 0.22, b: 0.18, a: 1.0 }
              : { r: 0.015, g: 0.015, b: 0.02, a: 1.0 },
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

      // Theater room: walls + ceiling
      pass.setPipeline(wallPipeline);
      pass.setBindGroup(0, wallCameraBindGroup);
      pass.setVertexBuffer(0, wallVertexBuffer);
      pass.draw(wallVertexCount, 1, 0, 0);

      // Curtains
      pass.setPipeline(curtainPipeline);
      pass.setBindGroup(0, curtainCameraBindGroup);
      pass.setVertexBuffer(0, curtainVertexBuffer);
      pass.draw(curtainVertexCount, 1, 0, 0);

      // Theater seats
      pass.setPipeline(seatPipeline);
      pass.setBindGroup(0, seatCameraBindGroup);
      pass.setVertexBuffer(0, seatVertexBuffer);
      pass.draw(seatVertexCount, 1, 0, 0);

      // Movie posters on left wall
      pass.setPipeline(posterPipeline);
      pass.setBindGroup(0, posterCameraBindGroup);

      pass.setBindGroup(1, posterBindGroup0);
      pass.setVertexBuffer(0, poster0VertexBuffer);
      pass.draw(posterVertexCount, 1, 0, 0);

      pass.setBindGroup(1, posterBindGroup1);
      pass.setVertexBuffer(0, poster1VertexBuffer);
      pass.draw(posterVertexCount, 1, 0, 0);

      pass.setBindGroup(1, posterBindGroup2);
      pass.setVertexBuffer(0, poster2VertexBuffer);
      pass.draw(posterVertexCount, 1, 0, 0);

      // Right wall posters
      pass.setBindGroup(1, rposterBindGroup0);
      pass.setVertexBuffer(0, rposter0VertexBuffer);
      pass.draw(posterVertexCount, 1, 0, 0);

      pass.setBindGroup(1, rposterBindGroup1);
      pass.setVertexBuffer(0, rposter1VertexBuffer);
      pass.draw(posterVertexCount, 1, 0, 0);

      pass.setBindGroup(1, rposterBindGroup2);
      pass.setVertexBuffer(0, rposter2VertexBuffer);
      pass.draw(posterVertexCount, 1, 0, 0);

      pass.setPipeline(framePipeline);
      pass.setBindGroup(0, frameCameraBindGroup);
      pass.setVertexBuffer(0, frameVertexBuffer);
      pass.draw(frameVertexCount, 1, 0, 0);

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

      pass.setPipeline(boomboxPipeline);
      pass.setBindGroup(0, boomboxCameraBindGroup);
      pass.setVertexBuffer(0, projectorVertexBuffer);
      pass.draw(projectorVertexCount, 1, 0, 0);

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
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (!message.includes("back resource")) {
            videoRenderEnabled = false;
            status(`Video texture disabled: ${message}`);
          }
        }
      }

      pass.end();
      device.queue.submit([encoder.finish()]);
    } catch (error) {
      console.error("Frame error:", error);
      status(`Frame error: ${getErrorMessage(error)}`);
    } finally {
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

main().catch((error) => {
  statusEl.textContent = `Error: ${getErrorMessage(error)}`;
  console.error(error);
});
