import { mountHiddenVideoJsPlayer } from "./videojs-player-host.js";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import "./style.css";

const canvas = document.getElementById("scene");
const statusEl = document.getElementById("status");
const telemetryEl = document.getElementById("telemetry");
const cursorLockButton = document.getElementById("cursor-lock");
const playButton = document.getElementById("video-play");
const pauseButton = document.getElementById("video-pause");

if (!navigator.gpu) {
  statusEl.textContent = "WebGPU is not available in this browser.";
  throw new Error("WebGPU unavailable");
}

const decoder = new TextDecoder();

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

function getGrassFloorShaderCode() {
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
  let sun_dir = normalize(vec3<f32>(0.35, 1.0, 0.2));
  let view_dir = normalize(vec3<f32>(0.0, 1.0, 0.0));
  let ndotl = max(dot(normal_ws, sun_dir), 0.0);
  let half_vec = normalize(sun_dir + view_dir);

  let spec_power = mix(96.0, 12.0, roughness);
  let specular = pow(max(dot(normal_ws, half_vec), 0.0), spec_power) * (1.0 - roughness) * 0.12;
  let hemi = clamp(normal_ws.y * 0.5 + 0.5, 0.0, 1.0);
  let ambient = mix(vec3<f32>(0.07, 0.09, 0.06), vec3<f32>(0.19, 0.28, 0.2), hemi);

  let color = albedo * (0.22 + 0.78 * ndotl) + albedo * ambient * 0.55 + vec3<f32>(specular);
  return vec4<f32>(color, 1.0);
}
`;
}

function hash2D(x, y, seed) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function sampleGrassHeight(x, y, size) {
  const xf = x / size;
  const yf = y / size;
  const broad = 0.5 + 0.5 * Math.sin(xf * 8.0 + yf * 3.2);
  const patches = 0.5 + 0.5 * Math.sin(xf * 31.0 - yf * 23.0);
  const grainA = hash2D(x, y, 1.9);
  const grainB = hash2D(x * 2.0, y * 2.0, 7.4);
  return broad * 0.45 + patches * 0.35 + grainA * 0.15 + grainB * 0.05;
}

function wrapIndex(value, size) {
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

function createGrassFloorTextures(device, size = 256) {
  const pixelCount = size * size;
  const heightData = new Float32Array(pixelCount);
  const albedoData = new Uint8Array(pixelCount * 4);
  const normalData = new Uint8Array(pixelCount * 4);
  const roughnessData = new Uint8Array(pixelCount);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      heightData[y * size + x] = sampleGrassHeight(x, y, size);
    }
  }

  for (let y = 0; y < size; y += 1) {
    const yDown = wrapIndex(y - 1, size);
    const yUp = wrapIndex(y + 1, size);
    for (let x = 0; x < size; x += 1) {
      const xLeft = wrapIndex(x - 1, size);
      const xRight = wrapIndex(x + 1, size);

      const idx = y * size + x;
      const idx4 = idx * 4;

      const h = heightData[idx];
      const hLeft = heightData[y * size + xLeft];
      const hRight = heightData[y * size + xRight];
      const hDown = heightData[yDown * size + x];
      const hUp = heightData[yUp * size + x];

      const variation = hash2D(x, y, 3.7);
      const patch = 0.5 + 0.5 * Math.sin((x + y) * 0.08 + h * 7.0);

      const red = 26 + h * 36 + variation * 10;
      const green = 88 + h * 120 + patch * 20;
      const blue = 22 + h * 28 + variation * 8;

      albedoData[idx4 + 0] = Math.max(0, Math.min(255, Math.round(red)));
      albedoData[idx4 + 1] = Math.max(0, Math.min(255, Math.round(green)));
      albedoData[idx4 + 2] = Math.max(0, Math.min(255, Math.round(blue)));
      albedoData[idx4 + 3] = 255;

      const slopeX = hRight - hLeft;
      const slopeY = hUp - hDown;
      const nx = -slopeX * 2.2;
      const ny = -slopeY * 2.2;
      const nz = 1.0;
      const normalLen = Math.hypot(nx, ny, nz) || 1.0;
      const tx = nx / normalLen;
      const ty = ny / normalLen;
      const tz = nz / normalLen;

      normalData[idx4 + 0] = Math.round((tx * 0.5 + 0.5) * 255.0);
      normalData[idx4 + 1] = Math.round((ty * 0.5 + 0.5) * 255.0);
      normalData[idx4 + 2] = Math.round((tz * 0.5 + 0.5) * 255.0);
      normalData[idx4 + 3] = 255;

      const roughness = 0.52 + (1.0 - h) * 0.3 + variation * 0.12;
      roughnessData[idx] = Math.round(
        Math.max(0, Math.min(1, roughness)) * 255.0,
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

function status(message) {
  statusEl.textContent = message;
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

async function loadBoomBoxVertices() {
  const loader = new FBXLoader();
  const root = await loader.loadAsync("/BoomBox.fbx");

  // Normalize model size so different FBX unit scales still appear in scene.
  root.position.set(0.0, 0.0, 0.0);
  root.rotation.set(0.0, 0.0, 0.0);
  root.scale.setScalar(1.0);
  root.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(root);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z);
  const targetMaxDim = 2.2;
  const scale =
    Number.isFinite(maxDim) && maxDim > 0.000001 ? targetMaxDim / maxDim : 1.0;

  root.scale.setScalar(scale);
  root.rotation.y = -0.22 * Math.PI;
  root.position.set(3.8, 0.0, -9.15);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  if (Number.isFinite(box.min.y)) {
    root.position.y += 0.03 - box.min.y;
  }
  root.updateMatrixWorld(true);

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
    } else {
      for (let i = 0; i < positions.count; i += 1) {
        temp.fromBufferAttribute(positions, i).applyMatrix4(matrix);
        vertices.push(temp.x, temp.y, temp.z);
      }
    }
  });

  if (vertices.length === 0) {
    throw new Error("BoomBox.fbx had no mesh vertices");
  }

  return {
    vertices: new Float32Array(vertices),
    scale,
    maxDim,
  };
}

async function main() {
  const mountedPlayer = await mountHiddenVideoJsPlayer({
    containerId: "videojs-player-root",
    src: "https://stream.mux.com/9iUYcsVCtyyWdPfHFsJNreL3j01K2V1xizq4ZcYHwXQs.m3u8",
    poster:
      "https://image.mux.com/9iUYcsVCtyyWdPfHFsJNreL3j01K2V1xizq4ZcYHwXQs/storyboard.png",
  });
  let videoElement = mountedPlayer.videoElement;
  const getMountedVideoElement = mountedPlayer.getVideoElement;

  videoElement.muted = false;
  videoElement.playsInline = true;
  videoElement.loop = true;

  let videoRenderEnabled = true;
  let videoRenderError = "";

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
  const floorShaderCode = getGrassFloorShaderCode();
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
  try {
    const boomboxMesh = await loadBoomBoxVertices();
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

  const cameraBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const cameraValues = new Float32Array(16);
  const floorCameraBindGroup = device.createBindGroup({
    layout: floorPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
  const floorTextures = createGrassFloorTextures(device);
  const floorSampler = device.createSampler({
    addressModeU: "repeat",
    addressModeV: "repeat",
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
  });
  const floorMaterialValues = new Float32Array([
    2.4, 2.4, 1.15, 0.08, 1.0, 1.0, 1.0, 0.0,
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
  let lookDeltaX = 0;
  let lookDeltaY = 0;
  let previousTime = performance.now();
  let depthTexture = null;

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
      const activeVideoElement = getMountedVideoElement?.();
      if (activeVideoElement instanceof HTMLVideoElement && activeVideoElement !== videoElement) {
        videoElement = activeVideoElement;
        videoElement.muted = false;
        videoElement.playsInline = true;
        videoElement.loop = true;
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
        `boombox: ${boomboxInfo}`;

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

      pass.setPipeline(archTextPipeline);
      pass.setBindGroup(0, archTextCameraBindGroup);
      pass.setBindGroup(1, archTextBindGroup);
      pass.setVertexBuffer(0, archTextVertexBuffer);
      pass.draw(archTextVertexCount, 1, 0, 0);

      if (
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
