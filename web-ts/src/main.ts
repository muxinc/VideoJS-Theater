import {
  mountHiddenVideoJsPlayer,
  changeVideoSource,
} from "./videojs-player-host";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  ARCH_TEXT_SHADER_CODE,
  CABINET_SHADER_CODE,
  CABINET_VERTICES,
  FLOOR_VERTICES,
  LABEL_SHADER_CODE,
  LAMP_SHADER_CODE,
  LAMP_VERTICES,
  MESH_SHADER_CODE,
  POSTER_0_VERTICES,
  POSTER_1_VERTICES,
  POSTER_2_VERTICES,
  POSTER_SHADER_CODE,
  RPOSTER_0_VERTICES,
  RPOSTER_1_VERTICES,
  RPOSTER_2_VERTICES,
  RUG_VERTICES,
  SCREEN_OFF_SHADER_CODE,
  SEAT_SHADER_CODE,
  SEAT_VERTICES,
  TAPE_SHADER_CODE,
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
const VCR_POSITION = new THREE.Vector3(0.0, 3.8, -9.18);

const DEFAULT_TAPE_PLAYBACK_ID = "9iUYcsVCtyyWdPfHFsJNreL3j01K2V1xizq4ZcYHwXQs";

const TAPE_MODEL_CONFIG = {
  url: "/tape.glb",
  targetMaxDim: 2.2,
  rotation: new THREE.Euler(0.0, 0.18 * Math.PI, 0.0),
  floorOffset: 0.03,
};

const TAPE_DEFINITIONS = [
  {
    id: "twister",
    title: "Twister",
    playbackId: DEFAULT_TAPE_PLAYBACK_ID,
    labelBg: "#dbc193",
    labelStripe: "#c4622e",
    labelInk: "#24140c",
    position: new THREE.Vector3(-8.2, 0.42, -8.98),
    rotation: new THREE.Euler(0.0, Math.PI * 0.5, 0.0),
  },
  {
    id: "batman",
    title: "Batman",
    playbackId: DEFAULT_TAPE_PLAYBACK_ID,
    labelBg: "#d7c978",
    labelStripe: "#1c1d22",
    labelInk: "#16120f",
    position: new THREE.Vector3(-7.2, 0.42, -8.98),
    rotation: new THREE.Euler(0.0, Math.PI * 0.5, 0.0),
  },
  {
    id: "terminator2",
    title: "Terminator 2",
    playbackId: DEFAULT_TAPE_PLAYBACK_ID,
    labelBg: "#cad0d7",
    labelStripe: "#5f6f84",
    labelInk: "#17181b",
    position: new THREE.Vector3(-5.4, 0.42, -8.98),
    rotation: new THREE.Euler(0.0, Math.PI * 0.5, 0.0),
  },
  {
    id: "home-video",
    title: "Home Video '94",
    playbackId: DEFAULT_TAPE_PLAYBACK_ID,
    labelBg: "#eee2c9",
    labelStripe: "#7a8c70",
    labelInk: "#2a231d",
    position: new THREE.Vector3(-8.2, 1.32, -8.98),
    rotation: new THREE.Euler(0.0, Math.PI * 0.5, 0.0),
  },
  {
    id: "alien",
    title: "Alien",
    playbackId: DEFAULT_TAPE_PLAYBACK_ID,
    labelBg: "#bcc6ab",
    labelStripe: "#334233",
    labelInk: "#171b15",
    position: new THREE.Vector3(-6.4, 1.32, -8.98),
    rotation: new THREE.Euler(0.0, Math.PI * 0.5, 0.0),
  },
  {
    id: "mix-tape",
    title: "Friday Mix",
    playbackId: DEFAULT_TAPE_PLAYBACK_ID,
    labelBg: "#efcfb7",
    labelStripe: "#c55f6b",
    labelInk: "#2c1b1d",
    position: new THREE.Vector3(-5.0, 1.32, -8.98),
    rotation: new THREE.Euler(0.0, Math.PI * 0.5, 0.0),
  },
];

function getTapeSrc(playbackId) {
  return `https://stream.mux.com/${playbackId}.m3u8`;
}

function getTapePoster(playbackId) {
  return `https://image.mux.com/${playbackId}/storyboard.png`;
}

const PLAYER_MODEL_CONFIG = {
  url: "/player.glb",
  targetMaxDim: 1.7,
  rotation: new THREE.Euler(0.0, 0.0, 0.0),
  position: new THREE.Vector3(0.0, 3.55, -9.18),
  floorOffset: 0.0,
};

const VIDEO_SCREEN_RECT = Object.freeze({
  left: -1.7,
  right: 1.7,
  top: 3.0,
  bottom: 0.75,
  z: -8.61,
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
      const taupeShift = macroNoise * 18 + tuftNoise * 14 + nap * 10;
      const coolShift = fiberNoise * 10 + fleck * 6;
      const r = 163 + taupeShift * 0.48 + coolShift * 0.06;
      const g = 142 + taupeShift * 0.34 - coolShift * 0.02;
      const b = 124 + taupeShift * 0.26 - coolShift * 0.1;

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

function createTapeLabelTexture(device, definition) {
  const width = 448;
  const height = 128;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create 2D canvas context for tape label");
  }

  ctx.fillStyle = definition.labelBg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.26)";
  ctx.fillRect(0, 0, width, 12);

  ctx.fillStyle = definition.labelStripe;
  ctx.fillRect(18, 18, width - 36, 26);

  ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
  ctx.fillRect(26, 60, width - 52, 40);

  ctx.strokeStyle = "rgba(79, 55, 31, 0.32)";
  ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, width - 16, height - 16);

  ctx.fillStyle = definition.labelInk;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font =
    definition.title.length > 12
      ? "700 34px 'Arial Narrow', 'Trebuchet MS', sans-serif"
      : "700 40px 'Arial Narrow', 'Trebuchet MS', sans-serif";
  ctx.fillText(definition.title, width / 2, 82);

  ctx.fillStyle = "rgba(34, 24, 16, 0.62)";
  ctx.font = "700 16px 'Arial', sans-serif";
  ctx.fillText("VHS", width - 42, 30);

  ctx.strokeStyle = "rgba(60, 44, 28, 0.3)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(24, height - 24);
  ctx.lineTo(width - 24, height - 24);
  ctx.stroke();

  const texture = device.createTexture({
    size: [width, height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.copyExternalImageToTexture({ source: canvasEl }, { texture }, [
    width,
    height,
    1,
  ]);
  return texture;
}

function appendTexturedQuad(vertices, a, b, c, d) {
  vertices.push(...a, 0.0, 0.0, ...b, 1.0, 0.0, ...c, 1.0, 1.0);
  vertices.push(...a, 0.0, 0.0, ...c, 1.0, 1.0, ...d, 0.0, 1.0);
}

function createTapeLabelLocalVertices(bounds) {
  const vertices = [];
  const insetX = (bounds.max.x - bounds.min.x) * 0.08;
  const insetY = (bounds.max.y - bounds.min.y) * 0.1;
  const frontPad = 0.06;
  const sideInset = (bounds.max.z - bounds.min.z) * 0.08;
  const x0 = bounds.min.x + insetX;
  const x1 = bounds.max.x - insetX;
  const y0 = bounds.min.y + insetY;
  const y1 = bounds.max.y - insetY;
  const zFront = bounds.max.z + frontPad;
  const zBack = bounds.min.z - frontPad;
  const z0 = bounds.min.z + sideInset;
  const z1 = bounds.max.z - sideInset;
  const xLeft = bounds.min.x - frontPad;
  const xRight = bounds.max.x + frontPad;

  appendTexturedQuad(
    vertices,
    [x0, y1, zFront],
    [x1, y1, zFront],
    [x1, y0, zFront],
    [x0, y0, zFront],
  );
  appendTexturedQuad(
    vertices,
    [x1, y1, zBack],
    [x0, y1, zBack],
    [x0, y0, zBack],
    [x1, y0, zBack],
  );
  appendTexturedQuad(
    vertices,
    [xLeft, y1, z0],
    [xLeft, y1, z1],
    [xLeft, y0, z1],
    [xLeft, y0, z0],
  );
  appendTexturedQuad(
    vertices,
    [xRight, y1, z1],
    [xRight, y1, z0],
    [xRight, y0, z0],
    [xRight, y0, z1],
  );

  return new Float32Array(vertices);
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

function transformTexturedVertices(
  localVertices,
  position,
  quaternion,
  target,
) {
  const transformed = target ?? new Float32Array(localVertices.length);
  const matrix = new THREE.Matrix4().compose(
    position,
    quaternion,
    new THREE.Vector3(1.0, 1.0, 1.0),
  );
  const temp = new THREE.Vector3();

  for (let i = 0; i < localVertices.length; i += 5) {
    temp.set(localVertices[i], localVertices[i + 1], localVertices[i + 2]);
    temp.applyMatrix4(matrix);
    transformed[i] = temp.x;
    transformed[i + 1] = temp.y;
    transformed[i + 2] = temp.z;
    transformed[i + 3] = localVertices[i + 3];
    transformed[i + 4] = localVertices[i + 4];
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
  const cabinetShaderCode = CABINET_SHADER_CODE;
  const frameShaderCode = TV_FRAME_SHADER_CODE;
  const boomboxShaderCode = MESH_SHADER_CODE;
  const archTextShaderCode = ARCH_TEXT_SHADER_CODE;
  const labelShaderCode = LABEL_SHADER_CODE;
  const lampShaderCode = LAMP_SHADER_CODE;
  const screenOffShaderCode = SCREEN_OFF_SHADER_CODE;
  const tapeShaderCode = TAPE_SHADER_CODE;
  const videoShaderCode = VIDEO_SHADER_CODE;
  const wallShaderCode = WALL_SHADER_CODE;
  const seatShaderCode = SEAT_SHADER_CODE;
  const posterShaderCode = POSTER_SHADER_CODE;

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

  const screenOffPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: device.createShaderModule({ code: screenOffShaderCode }),
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
      module: device.createShaderModule({ code: screenOffShaderCode }),
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
      cullMode: "none",
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
  const cabinetPipeline = createSimplePipeline(cabinetShaderCode);
  const lampPipeline = createSimplePipeline(lampShaderCode);
  const seatPipeline = createSimplePipeline(seatShaderCode);
  const tapePipeline = createSimplePipeline(tapeShaderCode);

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

  const labelModule = device.createShaderModule({ code: labelShaderCode });
  const labelPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: labelModule,
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
      module: labelModule,
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

  const cabinetVertexBuffer = uploadBuffer(
    device,
    CABINET_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const cabinetVertexCount = CABINET_VERTICES.length / 3;

  const lampVertexBuffer = uploadBuffer(
    device,
    LAMP_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const lampVertexCount = LAMP_VERTICES.length / 3;

  const rugVertexBuffer = uploadBuffer(
    device,
    RUG_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const rugVertexCount = RUG_VERTICES.length / 3;

  // Seat vertices
  const seatVertexBuffer = uploadBuffer(
    device,
    SEAT_VERTICES,
    GPUBufferUsage.VERTEX,
  );
  const seatVertexCount = SEAT_VERTICES.length / 3;

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
  const tapeRuntimes = [];
  let playerModelVertexBuffer = null;
  let playerModelVertexCount = 0;
  let tapeLabelLocalVertices = null;

  try {
    const tapeModelMesh = await loadModelMesh({
      loader: new GLTFLoader(),
      ...TAPE_MODEL_CONFIG,
    });
    tapeLabelLocalVertices = createTapeLabelLocalVertices(tapeModelMesh.bounds);
    const pickupAnchorLocal = tapeModelMesh.bounds.getCenter(
      new THREE.Vector3(),
    );

    for (const definition of TAPE_DEFINITIONS) {
      const worldQuaternion = new THREE.Quaternion().setFromEuler(
        definition.rotation,
      );
      const worldVertices = transformModelVertices(
        tapeModelMesh.vertices,
        definition.position,
        worldQuaternion,
      );
      const labelWorldVertices = transformTexturedVertices(
        tapeLabelLocalVertices,
        definition.position,
        worldQuaternion,
      );
      tapeRuntimes.push({
        definition,
        state: "world",
        targetable: false,
        localVertices: tapeModelMesh.vertices,
        worldVertices,
        vertexBuffer: createWritableVertexBuffer(device, worldVertices),
        vertexCount: tapeModelMesh.vertices.length / 3,
        worldPosition: definition.position.clone(),
        worldQuaternion,
        homePosition: definition.position.clone(),
        homeQuaternion: worldQuaternion.clone(),
        pickupAnchorLocal: pickupAnchorLocal.clone(),
        labelLocalVertices: tapeLabelLocalVertices,
        labelWorldVertices,
        labelVertexBuffer: createWritableVertexBuffer(
          device,
          labelWorldVertices,
        ),
        labelTexture: createTapeLabelTexture(device, definition),
        labelBindGroup: null,
        labelVertexCount: tapeLabelLocalVertices.length / 5,
      });
    }
  } catch (error) {
    console.error("tape.glb load failed:", error);
    status(`tape.glb load failed: ${getErrorMessage(error)}`);
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
  const screenOffCameraBindGroup = device.createBindGroup({
    layout: screenOffPipeline.getBindGroupLayout(0),
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
  const cabinetCameraBindGroup = device.createBindGroup({
    layout: cabinetPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: roomLightBuffer } },
    ],
  });
  const lampCameraBindGroup = device.createBindGroup({
    layout: lampPipeline.getBindGroupLayout(0),
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
  const posterCameraBindGroup = device.createBindGroup({
    layout: posterPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: roomLightBuffer } },
    ],
  });
  const labelCameraBindGroup = device.createBindGroup({
    layout: labelPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: roomLightBuffer } },
    ],
  });
  const tapeCameraBindGroup = device.createBindGroup({
    layout: tapePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: roomLightBuffer } },
    ],
  });
  const posterSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });
  for (const tapeRuntime of tapeRuntimes) {
    tapeRuntime.labelBindGroup = device.createBindGroup({
      layout: labelPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: posterSampler },
        { binding: 1, resource: tapeRuntime.labelTexture.createView() },
      ],
    });
  }
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

  function getHeldTape() {
    return tapeRuntimes.find((runtime) => runtime.state === "held") ?? null;
  }

  function getInsertedTape() {
    return tapeRuntimes.find((runtime) => runtime.state === "inserted") ?? null;
  }

  function getTargetedTape() {
    return tapeRuntimes.find((runtime) => runtime.targetable) ?? null;
  }

  function performTapeAction() {
    const heldTape = getHeldTape();
    const insertedTape = getInsertedTape();
    const targetedTape = getTargetedTape();

    if (heldTape && vcrNearby) {
      heldTape.state = "inserted";
      heldTape.targetable = false;
      tapeInserted = true;

      if (heldTape.worldVertices) {
        heldTape.worldVertices.fill(0);
        device.queue.writeBuffer(
          heldTape.vertexBuffer,
          0,
          heldTape.worldVertices,
        );
      }
      heldTape.labelWorldVertices.fill(0);
      device.queue.writeBuffer(
        heldTape.labelVertexBuffer,
        0,
        heldTape.labelWorldVertices,
      );

      const activeVid = getMountedVideoElement?.() ?? videoElement;
      if (activeVid instanceof HTMLVideoElement) {
        videoElement = activeVid;
      }
      const playPromise = changeVideoSource(
        videoElement,
        getTapeSrc(heldTape.definition.playbackId),
        getTapePoster(heldTape.definition.playbackId),
      );
      if (playPromise) {
        playPromise.catch(() => {
          status(
            `Tape inserted. Press Play to start ${heldTape.definition.title}.`,
          );
        });
      }
      videoRenderEnabled = true;
      status(`Now playing: ${heldTape.definition.title}`);
      return true;
    }

    if (insertedTape && vcrNearby) {
      resetInsertedTapeToHeld(insertedTape);
      tapeInserted = false;

      videoElement.pause();
      videoElement.removeAttribute("src");
      videoElement.load();
      status("Tape ejected.");
      return true;
    }

    if (heldTape && !vcrNearby) {
      const dropForward = new THREE.Vector3(
        cameraForward.x,
        0.0,
        cameraForward.z,
      ).normalize();
      const dropPos = new THREE.Vector3()
        .copy(cameraPosition)
        .addScaledVector(dropForward, TAPE_DROP_DISTANCE);
      dropPos.y = 0.0;

      heldTape.worldPosition.copy(dropPos);
      heldTape.worldQuaternion.copy(tapeBaseQuaternion);

      const dropVertices = transformModelVertices(
        heldTape.localVertices,
        heldTape.worldPosition,
        heldTape.worldQuaternion,
      );
      heldTape.worldVertices.set(dropVertices);
      device.queue.writeBuffer(
        heldTape.vertexBuffer,
        0,
        heldTape.worldVertices,
      );
      transformTexturedVertices(
        heldTape.labelLocalVertices,
        heldTape.worldPosition,
        heldTape.worldQuaternion,
        heldTape.labelWorldVertices,
      );
      device.queue.writeBuffer(
        heldTape.labelVertexBuffer,
        0,
        heldTape.labelWorldVertices,
      );

      heldTape.state = "world";
      heldTape.targetable = false;
      return true;
    }

    if (targetedTape) {
      targetedTape.state = "held";
      targetedTape.targetable = false;
      return true;
    }

    if (tapeRuntimes.some((runtime) => runtime.state === "world")) {
      tapePickupQueued = true;
      return true;
    }

    return false;
  }

  function resetInsertedTapeToHeld(insertedTape) {
    insertedTape.state = "held";
    insertedTape.targetable = false;
    transformModelVertices(
      insertedTape.localVertices,
      insertedTape.worldPosition,
      insertedTape.worldQuaternion,
      insertedTape.worldVertices,
    );
    device.queue.writeBuffer(
      insertedTape.vertexBuffer,
      0,
      insertedTape.worldVertices,
    );
    transformTexturedVertices(
      insertedTape.labelLocalVertices,
      insertedTape.worldPosition,
      insertedTape.worldQuaternion,
      insertedTape.labelWorldVertices,
    );
    device.queue.writeBuffer(
      insertedTape.labelVertexBuffer,
      0,
      insertedTape.labelWorldVertices,
    );
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

      // -- Tape pickup targeting --
      let bestTape = null;
      let bestTapeScore = -Infinity;
      for (const runtime of tapeRuntimes) {
        runtime.targetable = false;
        if (runtime.state !== "world") continue;
        tapePickupPoint
          .copy(runtime.pickupAnchorLocal)
          .applyQuaternion(runtime.worldQuaternion)
          .add(runtime.worldPosition);
        toTape.subVectors(tapePickupPoint, cameraPosition);
        const tapeDistance = toTape.length();
        if (tapeDistance <= 0.0001) continue;
        const tapeFacing = toTape.normalize().dot(cameraForward);
        if (
          tapeDistance <= TAPE_PICKUP_RADIUS &&
          tapeFacing >= TAPE_PICKUP_DOT_THRESHOLD
        ) {
          const score = tapeFacing * 2.0 - tapeDistance * 0.12;
          if (score > bestTapeScore) {
            bestTapeScore = score;
            bestTape = runtime;
          }
        }
      }
      if (bestTape) {
        bestTape.targetable = true;
      }
      if (tapePickupQueued && bestTape) {
        bestTape.state = "held";
        bestTape.targetable = false;
      }
      tapePickupQueued = false;

      // -- Tape held: attach to hand --
      const heldTape = getHeldTape();
      if (
        heldTape &&
        heldTape.localVertices &&
        heldTape.worldVertices &&
        heldTape.vertexBuffer
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
          heldTape.localVertices,
          tapeHeldPosition,
          tapeHeldQuaternion,
          heldTape.worldVertices,
        );
        device.queue.writeBuffer(
          heldTape.vertexBuffer,
          0,
          heldTape.worldVertices,
        );
        transformTexturedVertices(
          heldTape.labelLocalVertices,
          tapeHeldPosition,
          tapeHeldQuaternion,
          heldTape.labelWorldVertices,
        );
        device.queue.writeBuffer(
          heldTape.labelVertexBuffer,
          0,
          heldTape.labelWorldVertices,
        );
      }

      // -- Status messages --
      const insertedTape = getInsertedTape();
      const targetedTape = getTargetedTape();
      if (insertedTape) {
        if (vcrNearby) {
          setContextStatus("Press F to eject tape.");
        } else {
          setContextStatus(`Playing: ${insertedTape.definition.title}`);
        }
      } else if (heldTape) {
        if (vcrNearby) {
          setContextStatus("Press F to insert tape into player.");
        } else {
          setContextStatus(
            `Holding: ${heldTape.definition.title}. Press F to drop.`,
          );
        }
      } else if (targetedTape) {
        setContextStatus(
          `Press F to pick up ${targetedTape.definition.title}.`,
        );
      } else {
        setContextStatus("");
      }

      if (crosshairEl) {
        crosshairEl.dataset.state = heldTape
          ? "held"
          : insertedTape
            ? "held"
            : targetedTape || (vcrNearby && heldTape)
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

      // Room shell
      pass.setPipeline(wallPipeline);
      pass.setBindGroup(0, wallCameraBindGroup);
      pass.setVertexBuffer(0, wallVertexBuffer);
      pass.draw(wallVertexCount, 1, 0, 0);

      pass.setPipeline(cabinetPipeline);
      pass.setBindGroup(0, cabinetCameraBindGroup);
      pass.setVertexBuffer(0, cabinetVertexBuffer);
      pass.draw(cabinetVertexCount, 1, 0, 0);

      pass.setPipeline(lampPipeline);
      pass.setBindGroup(0, lampCameraBindGroup);
      pass.setVertexBuffer(0, lampVertexBuffer);
      pass.draw(lampVertexCount, 1, 0, 0);

      pass.setPipeline(seatPipeline);
      pass.setBindGroup(0, seatCameraBindGroup);
      pass.setVertexBuffer(0, rugVertexBuffer);
      pass.draw(rugVertexCount, 1, 0, 0);

      // Living-room couch
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

      for (const tapeRuntime of tapeRuntimes) {
        if (!tapeRuntime.vertexBuffer || tapeRuntime.vertexCount <= 0) continue;
        pass.setPipeline(tapePipeline);
        pass.setBindGroup(0, tapeCameraBindGroup);
        pass.setVertexBuffer(0, tapeRuntime.vertexBuffer);
        pass.draw(tapeRuntime.vertexCount, 1, 0, 0);
      }

      if (playerModelVertexBuffer && playerModelVertexCount > 0) {
        pass.setPipeline(boomboxPipeline);
        pass.setBindGroup(0, boomboxCameraBindGroup);
        pass.setVertexBuffer(0, playerModelVertexBuffer);
        pass.draw(playerModelVertexCount, 1, 0, 0);
      }

      pass.setPipeline(labelPipeline);
      pass.setBindGroup(0, labelCameraBindGroup);
      for (const tapeRuntime of tapeRuntimes) {
        if (!tapeRuntime.labelBindGroup) continue;
        pass.setBindGroup(1, tapeRuntime.labelBindGroup);
        pass.setVertexBuffer(0, tapeRuntime.labelVertexBuffer);
        pass.draw(tapeRuntime.labelVertexCount, 1, 0, 0);
      }

      pass.setPipeline(archTextPipeline);
      pass.setBindGroup(0, archTextCameraBindGroup);
      pass.setBindGroup(1, archTextBindGroup);
      pass.setVertexBuffer(0, archTextVertexBuffer);
      pass.draw(archTextVertexCount, 1, 0, 0);

      const shouldRenderVideo =
        tapeInserted &&
        videoRenderEnabled &&
        videoElement.readyState >= 2 &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0 &&
        !videoElement.paused;

      if (!shouldRenderVideo) {
        pass.setPipeline(screenOffPipeline);
        pass.setBindGroup(0, screenOffCameraBindGroup);
        pass.setVertexBuffer(0, videoVertexBuffer);
        pass.draw(videoVertexCount, 1, 0, 0);
      }

      if (shouldRenderVideo) {
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
