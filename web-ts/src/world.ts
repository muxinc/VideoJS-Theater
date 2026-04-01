type Vec3 = {
  x: number;
  y: number;
  z: number;
};

const FLOOR_VERTICES_RAW = [
  -15.0, 0.0, -10.5, 15.0, 0.0, -10.5, 15.0, 0.0, 15.0, -15.0, 0.0, -10.5, 15.0,
  0.0, 15.0, -15.0, 0.0, 15.0,
];

const VIDEO_VERTICES_RAW = [
  -3.4, 3.2, -9.79, 0.0, 0.0, 3.4, 3.2, -9.79, 1.0, 0.0, 3.4, 0.9, -9.79, 1.0,
  1.0, -3.4, 3.2, -9.79, 0.0, 0.0, 3.4, 0.9, -9.79, 1.0, 1.0, -3.4, 0.9, -9.79,
  0.0, 1.0,
];

const WALL_VERTICES_RAW = [
  -15.0, 6.0, -10.5, 15.0, 6.0, -10.5, 15.0, 0.0, -10.5, -15.0, 6.0, -10.5,
  15.0, 0.0, -10.5, -15.0, 0.0, -10.5, -15.0, 6.0, -10.5, -15.0, 6.0, 15.0,
  -15.0, 0.0, 15.0, -15.0, 6.0, -10.5, -15.0, 0.0, 15.0, -15.0, 0.0, -10.5,
  15.0, 6.0, 15.0, 15.0, 6.0, -10.5, 15.0, 0.0, -10.5, 15.0, 6.0, 15.0, 15.0,
  0.0, -10.5, 15.0, 0.0, 15.0, -15.0, 6.0, -10.5, 15.0, 6.0, -10.5, 15.0, 6.0,
  15.0, -15.0, 6.0, -10.5, 15.0, 6.0, 15.0, -15.0, 6.0, 15.0,
];

const CURTAIN_VERTICES_RAW = [
  -6.5, 5.0, -10.2, -4.5, 5.0, -10.2, -4.5, 0.0, -10.2, -6.5, 5.0, -10.2, -4.5,
  0.0, -10.2, -6.5, 0.0, -10.2, 4.5, 5.0, -10.2, 6.5, 5.0, -10.2, 6.5, 0.0,
  -10.2, 4.5, 5.0, -10.2, 6.5, 0.0, -10.2, 4.5, 0.0, -10.2,
];

function cuboidVertices(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  zMin: number,
  zMax: number,
): number[] {
  return [
    xMin,
    yMax,
    zMax,
    xMax,
    yMax,
    zMax,
    xMax,
    yMin,
    zMax,
    xMin,
    yMax,
    zMax,
    xMax,
    yMin,
    zMax,
    xMin,
    yMin,
    zMax,
    xMax,
    yMax,
    zMin,
    xMin,
    yMax,
    zMin,
    xMin,
    yMin,
    zMin,
    xMax,
    yMax,
    zMin,
    xMin,
    yMin,
    zMin,
    xMax,
    yMin,
    zMin,
    xMin,
    yMax,
    zMin,
    xMin,
    yMax,
    zMax,
    xMin,
    yMin,
    zMax,
    xMin,
    yMax,
    zMin,
    xMin,
    yMin,
    zMax,
    xMin,
    yMin,
    zMin,
    xMax,
    yMax,
    zMax,
    xMax,
    yMax,
    zMin,
    xMax,
    yMin,
    zMin,
    xMax,
    yMax,
    zMax,
    xMax,
    yMin,
    zMin,
    xMax,
    yMin,
    zMax,
    xMin,
    yMax,
    zMin,
    xMax,
    yMax,
    zMin,
    xMax,
    yMax,
    zMax,
    xMin,
    yMax,
    zMin,
    xMax,
    yMax,
    zMax,
    xMin,
    yMax,
    zMax,
    xMin,
    yMin,
    zMax,
    xMax,
    yMin,
    zMax,
    xMax,
    yMin,
    zMin,
    xMin,
    yMin,
    zMax,
    xMax,
    yMin,
    zMin,
    xMin,
    yMin,
    zMin,
  ];
}

function theaterSeat(cx: number, rowZ: number): number[] {
  const width = 0.7;
  const legWidth = 0.06;
  const legDepth = 0.06;
  const legHeight = 0.42;
  const seatHeight = 0.08;
  const seatDepth = 0.48;
  const backHeight = 0.55;
  const backDepth = 0.06;
  const seatTop = legHeight + seatHeight;

  return [
    ...cuboidVertices(
      cx,
      cx + legWidth,
      0.0,
      legHeight,
      rowZ + seatDepth - legDepth,
      rowZ + seatDepth,
    ),
    ...cuboidVertices(
      cx + width - legWidth,
      cx + width,
      0.0,
      legHeight,
      rowZ + seatDepth - legDepth,
      rowZ + seatDepth,
    ),
    ...cuboidVertices(
      cx,
      cx + width,
      legHeight,
      seatTop,
      rowZ,
      rowZ + seatDepth,
    ),
    ...cuboidVertices(
      cx,
      cx + width,
      seatTop,
      seatTop + backHeight,
      rowZ + seatDepth - backDepth,
      rowZ + seatDepth,
    ),
  ];
}

function seatRowVertices(rowZ: number): number[] {
  const vertices: number[] = [];
  const seatWidth = 0.7;
  const gap = 0.15;
  const totalWidth = seatWidth + gap;
  const startX = -3.5 * totalWidth + totalWidth * 0.5 - seatWidth * 0.5;

  for (let i = 0; i < 8; i += 1) {
    const cx = startX + i * totalWidth;
    vertices.push(...theaterSeat(cx, rowZ));
  }

  return vertices;
}

function posterQuad(zCenter: number): number[] {
  const x = -14.95;
  const halfWidth = 1.1;
  const halfHeight = 1.6;
  const centerY = 2.8;
  const z0 = zCenter - halfWidth;
  const z1 = zCenter + halfWidth;
  const y0 = centerY - halfHeight;
  const y1 = centerY + halfHeight;

  return [
    x,
    y1,
    z0,
    1.0,
    0.0,
    x,
    y1,
    z1,
    0.0,
    0.0,
    x,
    y0,
    z1,
    0.0,
    1.0,
    x,
    y1,
    z0,
    1.0,
    0.0,
    x,
    y0,
    z1,
    0.0,
    1.0,
    x,
    y0,
    z0,
    1.0,
    1.0,
  ];
}

function rightPosterQuad(zCenter: number): number[] {
  const x = 14.95;
  const halfWidth = 1.1;
  const halfHeight = 1.6;
  const centerY = 2.8;
  const z0 = zCenter - halfWidth;
  const z1 = zCenter + halfWidth;
  const y0 = centerY - halfHeight;
  const y1 = centerY + halfHeight;

  return [
    x,
    y1,
    z1,
    1.0,
    0.0,
    x,
    y1,
    z0,
    0.0,
    0.0,
    x,
    y0,
    z0,
    0.0,
    1.0,
    x,
    y1,
    z1,
    1.0,
    0.0,
    x,
    y0,
    z0,
    0.0,
    1.0,
    x,
    y0,
    z1,
    1.0,
    1.0,
  ];
}

function toFloat32(values: number[]): Float32Array {
  return new Float32Array(values);
}

export const FLOOR_VERTICES = toFloat32(FLOOR_VERTICES_RAW);
export const TV_FRAME_VERTICES = toFloat32(
  cuboidVertices(-3.95, 3.95, 0.55, 3.55, -10.35, -9.85),
);
export const VIDEO_VERTICES = toFloat32(VIDEO_VERTICES_RAW);
export const WALL_VERTICES = toFloat32(WALL_VERTICES_RAW);
export const CURTAIN_VERTICES = toFloat32(CURTAIN_VERTICES_RAW);
export const SEAT_VERTICES = toFloat32([
  ...seatRowVertices(2.0),
  ...seatRowVertices(4.5),
  ...seatRowVertices(7.0),
]);
export const POSTER_0_VERTICES = toFloat32(posterQuad(-4.0));
export const POSTER_1_VERTICES = toFloat32(posterQuad(2.0));
export const POSTER_2_VERTICES = toFloat32(posterQuad(8.0));
export const RPOSTER_0_VERTICES = toFloat32(rightPosterQuad(-4.0));
export const RPOSTER_1_VERTICES = toFloat32(rightPosterQuad(2.0));
export const RPOSTER_2_VERTICES = toFloat32(rightPosterQuad(8.0));

export const TV_FRAME_SHADER_CODE = `
struct Camera {
  view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;

struct VSIn {
  @location(0) position: vec3<f32>,
};

struct VSOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) world_pos: vec3<f32>,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
  var out: VSOut;
  out.world_pos = input.position;
  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let edge = smoothstep(2.8, 3.95, abs(input.world_pos.x));
  let scan = 0.01 * sin(input.world_pos.y * 40.0);
  let base = vec3<f32>(0.02, 0.02, 0.025);
  let glow = vec3<f32>(0.04, 0.05, 0.07) * edge;
  return vec4<f32>(base + glow + vec3<f32>(scan), 1.0);
}
`;

export const MESH_SHADER_CODE = `
struct Camera {
  view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;

struct VSIn {
  @location(0) position: vec3<f32>,
};

struct VSOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) world_pos: vec3<f32>,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
  var out: VSOut;
  out.world_pos = input.position;
  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let dx = dpdx(input.world_pos);
  let dy = dpdy(input.world_pos);
  let n = normalize(cross(dx, dy));
  let light = normalize(vec3<f32>(0.45, 0.9, 0.35));
  let diffuse = max(dot(n, light), 0.0);
  let ambient = 0.1;
  let shade = ambient + diffuse * 0.3;
  let base = vec3<f32>(0.1, 0.1, 0.12);
  let accent = vec3<f32>(0.18, 0.16, 0.12) * smoothstep(0.0, 1.8, input.world_pos.y);
  return vec4<f32>((base + accent) * shade, 1.0);
}
`;

export const ARCH_TEXT_SHADER_CODE = `
struct Camera {
  view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var text_sampler: sampler;
@group(1) @binding(1) var text_tex: texture_2d<f32>;

struct VSIn {
  @location(0) position: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

struct VSOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
  var out: VSOut;
  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
  out.uv = input.uv;
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let c = textureSample(text_tex, text_sampler, input.uv);
  return c;
}
`;

export const VIDEO_SHADER_CODE = `
struct Camera {
  view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var video_sampler: sampler;
@group(1) @binding(1) var video_tex: texture_external;

struct VSIn {
  @location(0) position: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

struct VSOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
  var out: VSOut;
  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
  out.uv = input.uv;
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  return textureSampleBaseClampToEdge(video_tex, video_sampler, input.uv);
}
`;

export const WALL_SHADER_CODE = `
struct Camera {
  view_proj: mat4x4<f32>,
};
struct RoomLight {
  brightness: f32,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> room_light: RoomLight;

struct VSIn {
  @location(0) position: vec3<f32>,
};

struct VSOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) world_pos: vec3<f32>,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
  var out: VSOut;
  out.world_pos = input.position;
  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let dx = dpdx(input.world_pos);
  let dy = dpdy(input.world_pos);
  let n = normalize(cross(dx, dy));
  let light = normalize(vec3<f32>(0.0, 0.8, 0.3));
  let diffuse = max(dot(n, light), 0.0);
  let b = room_light.brightness;
  let shade = mix(0.04, 0.8, b) + diffuse * mix(0.1, 0.9, b);
  let base = vec3<f32>(0.06, 0.055, 0.05);
  var color = base * shade + base * b * 0.4;
  let screen_center = vec3<f32>(0.0, 2.0, -9.8);
  let to_screen = input.world_pos - screen_center;
  let sd = length(to_screen);
  let glow = clamp(1.0 / (1.0 + sd * sd * 0.04), 0.0, 1.0);
  color = color + vec3<f32>(0.08, 0.1, 0.14) * glow * 0.25 * (1.0 - b * 0.8);
  return vec4<f32>(color, 1.0);
}
`;

export const CURTAIN_SHADER_CODE = `
struct Camera {
  view_proj: mat4x4<f32>,
};
struct RoomLight {
  brightness: f32,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> room_light: RoomLight;

struct VSIn {
  @location(0) position: vec3<f32>,
};

struct VSOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) world_pos: vec3<f32>,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
  var out: VSOut;
  out.world_pos = input.position;
  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let b = room_light.brightness;
  let fold = 0.5 + 0.5 * sin(input.world_pos.x * 8.0);
  let drape = smoothstep(0.0, 4.5, input.world_pos.y);
  let shade = mix(0.15, 1.0, b) + fold * mix(0.12, 0.4, b) + drape * 0.08;
  let velvet = vec3<f32>(0.55, 0.05, 0.07);
  return vec4<f32>(velvet * shade, 1.0);
}
`;

export const SEAT_SHADER_CODE = `
struct Camera {
  view_proj: mat4x4<f32>,
};
struct RoomLight {
  brightness: f32,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> room_light: RoomLight;

struct VSIn {
  @location(0) position: vec3<f32>,
};

struct VSOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) world_pos: vec3<f32>,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
  var out: VSOut;
  out.world_pos = input.position;
  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let b = room_light.brightness;
  let dx = dpdx(input.world_pos);
  let dy = dpdy(input.world_pos);
  let n = normalize(cross(dx, dy));
  let light = normalize(vec3<f32>(0.0, 0.9, -0.3));
  let diffuse = max(dot(n, light), 0.0);
  let shade = mix(0.08, 0.85, b) + diffuse * mix(0.15, 0.8, b);
  let y = input.world_pos.y;
  let leg_metal = vec3<f32>(0.06, 0.06, 0.07);
  let cushion = vec3<f32>(0.5, 0.06, 0.08);
  let backrest = vec3<f32>(0.45, 0.04, 0.06);
  let is_cushion = smoothstep(0.38, 0.44, y) * (1.0 - smoothstep(0.48, 0.52, y));
  let is_back = smoothstep(0.48, 0.54, y);
  var color = leg_metal;
  color = mix(color, cushion, is_cushion);
  color = mix(color, backrest, is_back);
  return vec4<f32>(color * shade, 1.0);
}
`;

export const POSTER_SHADER_CODE = `
struct Camera {
  view_proj: mat4x4<f32>,
};
struct RoomLight {
  brightness: f32,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> room_light: RoomLight;
@group(1) @binding(0) var poster_sampler: sampler;
@group(1) @binding(1) var poster_tex: texture_2d<f32>;

struct VSIn {
  @location(0) position: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

struct VSOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) world_pos: vec3<f32>,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
  var out: VSOut;
  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
  out.uv = input.uv;
  out.world_pos = input.position;
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let b = room_light.brightness;
  let tex = textureSample(poster_tex, poster_sampler, input.uv);
  let shade = mix(0.12, 0.9, b);
  return vec4<f32>(tex.rgb * shade, tex.a);
}
`;

function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vecSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vecScale(v: Vec3, scalar: number): Vec3 {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len <= 0.00001) {
    return { x: 0.0, y: 0.0, z: 0.0 };
  }
  return vecScale(v, 1 / len);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function safeAspect(width: number, height: number): number {
  return Math.max(width, 1) / Math.max(height, 1);
}

function perspectiveRH(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const tanHalf = Math.tan(fovY * 0.5);
  const f = 1.0 / tanHalf;
  const rangeInv = 1.0 / (near - far);
  const out = new Float32Array(16);

  out[0] = f / aspect;
  out[5] = f;
  out[10] = far * rangeInv;
  out[11] = -1.0;
  out[14] = far * near * rangeInv;
  return out;
}

function lookAtRH(eye: Vec3, center: Vec3, upHint: Vec3): Float32Array {
  const f = normalize(vecSub(center, eye));
  const s = normalize(cross(f, upHint));
  const u = cross(s, f);

  return new Float32Array([
    s.x,
    u.x,
    -f.x,
    0.0,
    s.y,
    u.y,
    -f.y,
    0.0,
    s.z,
    u.z,
    -f.z,
    0.0,
    -dot(s, eye),
    -dot(u, eye),
    dot(f, eye),
    1.0,
  ]);
}

function mulMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);

  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0.0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }

  return out;
}

export class WorldState {
  position: Vec3 = { x: 0.0, y: 1.8, z: 8.0 };

  yaw = -Math.PI / 2.0;

  pitch = -0.18;

  aspect = 16.0 / 9.0;

  fovY = (65.0 * Math.PI) / 180.0;

  near = 0.1;

  far = 500.0;

  viewProj: Float32Array = new Float32Array([
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0,
    1.0,
  ]);

  cameraPosition: Float32Array = new Float32Array([0.0, 0.0, 0.0]);

  cameraForward: Float32Array = new Float32Array([0.0, 0.0, -1.0]);

  cameraRight: Float32Array = new Float32Array([1.0, 0.0, 0.0]);

  cameraUp: Float32Array = new Float32Array([0.0, 1.0, 0.0]);

  init(width: number, height: number): void {
    this.position = { x: 0.0, y: 1.8, z: 8.0 };
    this.yaw = -Math.PI / 2.0;
    this.pitch = -0.18;
    this.aspect = safeAspect(width, height);
    this.recomputeViewProjection();
  }

  resize(width: number, height: number): void {
    this.aspect = safeAspect(width, height);
    this.recomputeViewProjection();
  }

  update(
    dtSeconds: number,
    moveForward: number,
    moveRight: number,
    moveUp: number,
    lookDeltaX: number,
    lookDeltaY: number,
    sprint: number,
  ): void {
    const dt = clamp(dtSeconds, 0.0, 0.05);
    const mouseSensitivity = 0.0025;

    this.yaw += lookDeltaX * mouseSensitivity;
    this.pitch += lookDeltaY * mouseSensitivity;
    this.pitch = clamp(this.pitch, -1.54, 1.54);

    const forward = this.computeForward();
    const worldUp = { x: 0.0, y: 1.0, z: 0.0 };
    const rightAxis = normalize(cross(forward, worldUp));
    const baseSpeed = sprint !== 0 ? 15.0 : 7.0;

    let velocity = { x: 0.0, y: 0.0, z: 0.0 };
    velocity = vecAdd(velocity, vecScale(forward, moveForward * baseSpeed));
    velocity = vecAdd(velocity, vecScale(rightAxis, moveRight * baseSpeed));
    velocity = vecAdd(velocity, vecScale(worldUp, moveUp * baseSpeed));
    this.position = vecAdd(this.position, vecScale(velocity, dt));

    this.recomputeViewProjection();
  }

  private recomputeViewProjection(): void {
    const forward = this.computeForward();
    const up = { x: 0.0, y: 1.0, z: 0.0 };
    const right = normalize(cross(forward, up));
    const cameraUp = normalize(cross(right, forward));
    const target = vecAdd(this.position, forward);
    const view = lookAtRH(this.position, target, up);
    const proj = perspectiveRH(this.fovY, this.aspect, this.near, this.far);

    this.viewProj.set(mulMat4(proj, view));
    this.cameraPosition.set([
      this.position.x,
      this.position.y,
      this.position.z,
    ]);
    this.cameraForward.set([forward.x, forward.y, forward.z]);
    this.cameraRight.set([right.x, right.y, right.z]);
    this.cameraUp.set([cameraUp.x, cameraUp.y, cameraUp.z]);
  }

  private computeForward(): Vec3 {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);

    return normalize({
      x: cy * cp,
      y: sp,
      z: sy * cp,
    });
  }
}
