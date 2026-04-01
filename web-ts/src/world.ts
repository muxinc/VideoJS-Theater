type Vec3 = {
  x: number;
  y: number;
  z: number;
};

const TV_COLLIDER = Object.freeze({
  minX: -2.9,
  maxX: 2.9,
  minY: 0.0,
  maxY: 4.25,
  minZ: -10.2,
  maxZ: -8.15,
});

const CAMERA_COLLISION_RADIUS = 0.42;

const ROOM_BOUNDS = Object.freeze({
  minX: -15.0,
  maxX: 15.0,
  minY: 0.0,
  maxY: 6.0,
  minZ: -10.5,
  maxZ: 15.0,
});

const FLOOR_VERTICES_RAW = [
  -15.0, 0.0, -10.5, 15.0, 0.0, -10.5, 15.0, 0.0, 15.0, -15.0, 0.0, -10.5, 15.0,
  0.0, 15.0, -15.0, 0.0, 15.0,
];

const WALL_VERTICES_RAW = [
  -15.0, 6.0, -10.5, 15.0, 6.0, -10.5, 15.0, 0.0, -10.5, -15.0, 6.0, -10.5,
  15.0, 0.0, -10.5, -15.0, 0.0, -10.5, -15.0, 6.0, -10.5, -15.0, 6.0, 15.0,
  -15.0, 0.0, 15.0, -15.0, 6.0, -10.5, -15.0, 0.0, 15.0, -15.0, 0.0, -10.5,
  15.0, 6.0, 15.0, 15.0, 6.0, -10.5, 15.0, 0.0, -10.5, 15.0, 6.0, 15.0, 15.0,
  0.0, -10.5, 15.0, 0.0, 15.0, -15.0, 6.0, -10.5, 15.0, 6.0, -10.5, 15.0, 6.0,
  15.0, -15.0, 6.0, -10.5, 15.0, 6.0, 15.0, -15.0, 6.0, 15.0,
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

function crtBubbleScreenVertices(): number[] {
  const vertices: number[] = [];
  const left = -1.64;
  const right = 1.64;
  const top = 2.94;
  const bottom = 0.81;
  const edgeZ = -8.69;
  const centerBulge = 0.09;
  const xSegments = 18;
  const ySegments = 12;

  function sample(
    ix: number,
    iy: number,
  ): [number, number, number, number, number] {
    const u = ix / xSegments;
    const v = iy / ySegments;
    const x = left + (right - left) * u;
    const y = top + (bottom - top) * v;
    const nx = (u - 0.5) * 2.0;
    const ny = (v - 0.5) * 2.0;
    const radial = clamp(1.0 - (nx * nx + ny * ny) * 0.72, 0.0, 1.0);
    const z = edgeZ + radial * centerBulge;
    return [x, y, z, u, v];
  }

  for (let iy = 0; iy < ySegments; iy += 1) {
    for (let ix = 0; ix < xSegments; ix += 1) {
      const a = sample(ix, iy);
      const b = sample(ix + 1, iy);
      const c = sample(ix + 1, iy + 1);
      const d = sample(ix, iy + 1);

      vertices.push(...a, ...b, ...c);
      vertices.push(...a, ...c, ...d);
    }
  }

  return vertices;
}

function oldSchoolTvFrameVertices(): number[] {
  const vertices: number[] = [];

  // Main cabinet body
  vertices.push(...cuboidVertices(-2.45, 2.45, 0.25, 3.55, -10.05, -8.72));

  // Front bezel around the CRT glass
  vertices.push(...cuboidVertices(-2.18, 2.18, 2.94, 3.24, -8.72, -8.43));
  vertices.push(...cuboidVertices(-2.18, 2.18, 0.53, 0.81, -8.72, -8.43));
  vertices.push(...cuboidVertices(-2.18, -1.86, 0.81, 2.94, -8.72, -8.43));
  vertices.push(...cuboidVertices(1.86, 2.18, 0.81, 2.94, -8.72, -8.43));

  // Speaker band and narrow side control strip
  vertices.push(...cuboidVertices(-1.92, 1.22, 0.35, 0.66, -8.72, -8.44));
  vertices.push(...cuboidVertices(1.88, 2.18, 0.88, 2.82, -8.72, -8.4));
  vertices.push(...cuboidVertices(1.76, 1.88, 0.88, 2.82, -8.72, -8.47));

  // Buttons, dial, feet
  vertices.push(...cuboidVertices(1.95, 2.11, 2.28, 2.46, -8.39, -8.21));
  vertices.push(...cuboidVertices(1.95, 2.11, 1.92, 2.1, -8.39, -8.24));
  vertices.push(...cuboidVertices(1.95, 2.11, 1.6, 1.78, -8.39, -8.24));
  vertices.push(...cuboidVertices(1.95, 2.11, 1.28, 1.46, -8.39, -8.24));
  vertices.push(...cuboidVertices(-2.2, -1.75, 0.0, 0.25, -9.65, -9.2));
  vertices.push(...cuboidVertices(1.75, 2.2, 0.0, 0.25, -9.65, -9.2));

  return vertices;
}

function livingRoomCouchVertices(): number[] {
  const vertices: number[] = [];

  // Feet
  vertices.push(...cuboidVertices(-2.45, -2.18, 0.0, 0.16, 4.85, 5.12));
  vertices.push(...cuboidVertices(2.18, 2.45, 0.0, 0.16, 4.85, 5.12));
  vertices.push(...cuboidVertices(-2.45, -2.18, 0.0, 0.16, 7.08, 7.35));
  vertices.push(...cuboidVertices(2.18, 2.45, 0.0, 0.16, 7.08, 7.35));

  // Sofa base
  vertices.push(...cuboidVertices(-2.55, 2.55, 0.16, 0.58, 4.72, 7.48));

  // Seat cushion
  vertices.push(...cuboidVertices(-2.38, 2.38, 0.58, 0.94, 4.88, 7.08));

  // Backrest
  vertices.push(...cuboidVertices(-2.48, 2.48, 0.94, 1.98, 6.72, 7.45));

  // Armrests
  vertices.push(...cuboidVertices(-2.82, -2.34, 0.58, 1.44, 4.78, 7.3));
  vertices.push(...cuboidVertices(2.34, 2.82, 0.58, 1.44, 4.78, 7.3));

  // Front apron to thicken the silhouette
  vertices.push(...cuboidVertices(-2.5, 2.5, 0.34, 0.68, 4.62, 4.92));

  return vertices;
}

function persianRugVertices(): number[] {
  return [
    -3.9, 0.02, 1.55, 3.9, 0.02, 1.55, 3.9, 0.02, 6.05, -3.9, 0.02, 1.55, 3.9,
    0.02, 6.05, -3.9, 0.02, 6.05,
  ];
}

function floorLampVertices(): number[] {
  const vertices: number[] = [];

  // Base
  vertices.push(...cuboidVertices(11.88, 13.08, 0.0, 0.1, 11.78, 12.98));

  // Stem and neck
  vertices.push(...cuboidVertices(12.43, 12.57, 0.1, 2.48, 12.33, 12.47));
  vertices.push(...cuboidVertices(12.35, 12.65, 2.48, 2.6, 12.25, 12.55));

  // Lamp shade
  vertices.push(...cuboidVertices(11.86, 13.14, 2.28, 2.68, 11.82, 13.1));
  vertices.push(...cuboidVertices(12.04, 12.96, 2.68, 3.1, 12.0, 12.92));

  // Inner bulb housing
  vertices.push(...cuboidVertices(12.32, 12.68, 2.34, 2.74, 12.24, 12.6));

  return vertices;
}

function mediaCabinetVertices(): number[] {
  const vertices: number[] = [];

  // Outer frame as open cabinet panels
  vertices.push(...cuboidVertices(-9.22, -9.0, 0.12, 2.42, -10.1, -8.76));
  vertices.push(...cuboidVertices(-3.6, -3.38, 0.12, 2.42, -10.1, -8.76));
  vertices.push(...cuboidVertices(-9.0, -3.6, 2.18, 2.42, -10.1, -8.76));
  vertices.push(...cuboidVertices(-9.0, -3.6, 0.12, 0.34, -10.1, -8.76));
  vertices.push(...cuboidVertices(-9.0, -3.6, 0.34, 2.18, -10.1, -9.96));

  // Shelves and divider
  vertices.push(...cuboidVertices(-8.96, -3.64, 1.08, 1.2, -9.96, -8.82));
  vertices.push(...cuboidVertices(-6.4, -6.16, 0.34, 2.18, -9.96, -8.82));

  // Slight front lip and feet
  vertices.push(...cuboidVertices(-9.02, -3.58, 0.02, 0.12, -8.9, -8.76));
  vertices.push(...cuboidVertices(-8.9, -8.55, 0.0, 0.12, -9.98, -9.7));
  vertices.push(...cuboidVertices(-4.05, -3.7, 0.0, 0.12, -9.98, -9.7));

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
export const TV_FRAME_VERTICES = toFloat32(oldSchoolTvFrameVertices());
export const VIDEO_VERTICES = toFloat32(crtBubbleScreenVertices());
export const WALL_VERTICES = toFloat32(WALL_VERTICES_RAW);
export const CABINET_VERTICES = toFloat32(mediaCabinetVertices());
export const SEAT_VERTICES = toFloat32(livingRoomCouchVertices());
export const RUG_VERTICES = toFloat32(persianRugVertices());
export const LAMP_VERTICES = toFloat32(floorLampVertices());
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
  let speakerBand = (1.0 - smoothstep(0.66, 0.96, input.world_pos.y)) *
    (1.0 - smoothstep(1.28, 2.04, abs(input.world_pos.x)));
  let grill = speakerBand * (0.35 + 0.35 * sin(input.world_pos.x * 45.0));
  let controlStrip = smoothstep(1.84, 1.98, input.world_pos.x) *
    (1.0 - smoothstep(2.9, 3.02, input.world_pos.y)) *
    smoothstep(0.82, 1.0, input.world_pos.y);
  let dialZone = smoothstep(1.92, 2.02, input.world_pos.x) *
    smoothstep(2.18, 2.3, input.world_pos.y) *
    (1.0 - smoothstep(2.46, 2.58, input.world_pos.y)) *
    smoothstep(-8.4, -8.32, input.world_pos.z);
  let buttonColumn = smoothstep(1.92, 2.02, input.world_pos.x) *
    smoothstep(-8.4, -8.31, input.world_pos.z);
  let button0 = buttonColumn * smoothstep(1.28, 1.36, input.world_pos.y) *
    (1.0 - smoothstep(1.46, 1.54, input.world_pos.y));
  let button1 = buttonColumn * smoothstep(1.6, 1.68, input.world_pos.y) *
    (1.0 - smoothstep(1.78, 1.86, input.world_pos.y));
  let button2 = buttonColumn * smoothstep(1.92, 2.0, input.world_pos.y) *
    (1.0 - smoothstep(2.1, 2.18, input.world_pos.y));
  let buttonSpec = max(button0, max(button1, button2));
  var color = vec3<f32>(0.18, 0.19, 0.2);
  color = mix(color, vec3<f32>(0.13, 0.14, 0.15), grill * 0.7);
  color = mix(color, vec3<f32>(0.16, 0.17, 0.18), controlStrip * 0.8);
  color = mix(color, vec3<f32>(0.56, 0.57, 0.6), dialZone * 0.95);
  color = mix(color, vec3<f32>(0.5, 0.52, 0.55), buttonSpec * 0.95);
  return vec4<f32>(color, 1.0);
}
`;

export const CABINET_SHADER_CODE = `
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
  let light = normalize(vec3<f32>(-0.3, 0.92, -0.24));
  let diffuse = max(dot(n, light), 0.0);
  let shade = mix(0.12, 0.94, b) + diffuse * mix(0.12, 0.44, b);
  let grain = 0.5 + 0.5 * sin(input.world_pos.x * 7.5 + input.world_pos.y * 3.2);
  let grainFine = 0.5 + 0.5 * sin(input.world_pos.x * 24.0 + input.world_pos.z * 11.0);
  let openingShadow = smoothstep(-9.82, -9.74, input.world_pos.z) *
    smoothstep(0.1, 0.3, input.world_pos.y) *
    (1.0 - smoothstep(2.26, 2.4, input.world_pos.y));
  var color = vec3<f32>(0.41, 0.28, 0.16);
  color = color + vec3<f32>(0.08, 0.05, 0.02) * (grain * 0.55 + grainFine * 0.2);
  color = mix(color, vec3<f32>(0.19, 0.12, 0.07), openingShadow * 0.85);
  return vec4<f32>(color * shade, 1.0);
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

export const TAPE_SHADER_CODE = `
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
  let light = normalize(vec3<f32>(0.28, 0.88, -0.34));
  let diffuse = max(dot(n, light), 0.0);
  let shade = mix(0.18, 0.96, b) + diffuse * mix(0.14, 0.42, b);
  let frontLip = smoothstep(-9.5, -8.95, input.world_pos.z);
  let topSheen = smoothstep(0.16, 0.48, fract(input.world_pos.y * 2.7));
  var color = vec3<f32>(0.2, 0.2, 0.22);
  color = mix(color, vec3<f32>(0.29, 0.29, 0.31), frontLip * 0.35 + topSheen * 0.08);
  return vec4<f32>(color * shade, 1.0);
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
  let centered = input.uv * 2.0 - vec2<f32>(1.0, 1.0);
  let warp = centered * (1.0 + 0.075 * dot(centered, centered));
  let uv = warp * 0.5 + vec2<f32>(0.5, 0.5);
  let vignette = clamp(1.0 - dot(centered, centered) * 0.28, 0.0, 1.0);
  let scan = 0.97 + 0.03 * sin(input.uv.y * 480.0);
  let texel = textureSampleBaseClampToEdge(video_tex, video_sampler, uv);
  let crtTint = vec3<f32>(0.98, 1.0, 0.94);
  let color = texel.rgb * crtTint * vignette * scan;
  return vec4<f32>(color, texel.a);
}
`;

export const SCREEN_OFF_SHADER_CODE = `
struct Camera {
  view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;

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
  let centered = input.uv * 2.0 - vec2<f32>(1.0, 1.0);
  let vignette = clamp(1.0 - dot(centered, centered) * 0.32, 0.0, 1.0);
  let reflection = 0.06 * smoothstep(-0.05, 0.55, 1.0 - input.uv.y);
  let glass = vec3<f32>(0.01, 0.01, 0.012) * vignette + vec3<f32>(reflection * 0.4);
  return vec4<f32>(glass, 1.0);
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
  let base = vec3<f32>(0.55, 0.42, 0.30);
  var color = base * shade + base * b * 0.4;
  let screen_center = vec3<f32>(0.0, 1.9, -8.61);
  let to_screen = input.world_pos - screen_center;
  let sd = length(to_screen);
  let glow = clamp(1.0 / (1.0 + sd * sd * 0.04), 0.0, 1.0);
  color = color + vec3<f32>(0.07, 0.09, 0.11) * glow * 0.14 * (1.0 - b * 0.8);
  return vec4<f32>(color, 1.0);
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
  let xEdge = smoothstep(2.2, 2.8, abs(input.world_pos.x));
  let feet = vec3<f32>(0.24, 0.15, 0.08);
  let upholstery = vec3<f32>(0.48, 0.31, 0.18);
  let cushion = vec3<f32>(0.56, 0.36, 0.22);
  let backrest = vec3<f32>(0.42, 0.26, 0.15);
  let is_feet = 1.0 - smoothstep(0.14, 0.22, y);
  let is_cushion = smoothstep(0.56, 0.7, y) * (1.0 - smoothstep(0.9, 1.02, y));
  let is_back = smoothstep(0.98, 1.2, y);
  var color = upholstery;
  color = mix(color, cushion, is_cushion * (1.0 - xEdge * 0.2));
  color = mix(color, backrest, is_back);
  color = mix(color, feet, is_feet);
  color = mix(color, backrest, xEdge * smoothstep(0.5, 1.3, y));
  return vec4<f32>(color * shade, 1.0);
}
`;

export const LAMP_SHADER_CODE = `
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
  let light = normalize(vec3<f32>(-0.25, 1.0, -0.15));
  let diffuse = max(dot(n, light), 0.0);
  let shade = mix(0.12, 0.92, b) + diffuse * mix(0.14, 0.55, b);

  let y = input.world_pos.y;
  let centered = input.world_pos - vec3<f32>(12.5, 2.55, 12.46);
  let bulb = smoothstep(0.32, 0.0, length(centered));
  let shadeMask = smoothstep(2.24, 2.42, y);
  let standMask = 1.0 - smoothstep(2.18, 2.34, y);

  var color = vec3<f32>(0.14, 0.13, 0.12);
  color = mix(color, vec3<f32>(0.77, 0.72, 0.58), shadeMask * 0.92);
  color = mix(color, vec3<f32>(0.22, 0.18, 0.12), standMask * 0.85);

  let emissive = vec3<f32>(1.0, 0.83, 0.55) * (bulb * (0.9 + b * 3.2) + shadeMask * b * 0.28);
  return vec4<f32>(color * shade + emissive, 1.0);
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

export const LABEL_SHADER_CODE = `
struct Camera {
  view_proj: mat4x4<f32>,
};
struct RoomLight {
  brightness: f32,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> room_light: RoomLight;
@group(1) @binding(0) var label_sampler: sampler;
@group(1) @binding(1) var label_tex: texture_2d<f32>;

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
  let b = room_light.brightness;
  let tex = textureSample(label_tex, label_sampler, input.uv);
  let shade = mix(0.56, 1.0, b);
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

function resolveTvCollision(previous: Vec3, next: Vec3): Vec3 {
  if (next.y < TV_COLLIDER.minY - 0.1 || next.y > TV_COLLIDER.maxY + 0.1) {
    return next;
  }

  const minX = TV_COLLIDER.minX - CAMERA_COLLISION_RADIUS;
  const maxX = TV_COLLIDER.maxX + CAMERA_COLLISION_RADIUS;
  const minZ = TV_COLLIDER.minZ - CAMERA_COLLISION_RADIUS;
  const maxZ = TV_COLLIDER.maxZ + CAMERA_COLLISION_RADIUS;

  if (next.x < minX || next.x > maxX || next.z < minZ || next.z > maxZ) {
    return next;
  }

  const resolved = { ...next };
  const crossedXMin = previous.x >= minX && next.x < minX;
  const crossedXMax = previous.x <= maxX && next.x > maxX;
  const crossedZMin = previous.z >= minZ && next.z < minZ;
  const crossedZMax = previous.z <= maxZ && next.z > maxZ;

  if (crossedXMin) resolved.x = minX;
  else if (crossedXMax) resolved.x = maxX;

  if (crossedZMin) resolved.z = minZ;
  else if (crossedZMax) resolved.z = maxZ;

  if (resolved.x === next.x && resolved.z === next.z) {
    const pushLeft = Math.abs(next.x - minX);
    const pushRight = Math.abs(maxX - next.x);
    const pushFront = Math.abs(next.z - minZ);
    const pushBack = Math.abs(maxZ - next.z);
    const smallest = Math.min(pushLeft, pushRight, pushFront, pushBack);

    if (smallest === pushLeft) resolved.x = minX;
    else if (smallest === pushRight) resolved.x = maxX;
    else if (smallest === pushFront) resolved.z = minZ;
    else resolved.z = maxZ;
  }

  return resolved;
}

function clampToRoom(pos: Vec3): Vec3 {
  return {
    x: clamp(
      pos.x,
      ROOM_BOUNDS.minX + CAMERA_COLLISION_RADIUS,
      ROOM_BOUNDS.maxX - CAMERA_COLLISION_RADIUS,
    ),
    y: clamp(
      pos.y,
      ROOM_BOUNDS.minY + CAMERA_COLLISION_RADIUS,
      ROOM_BOUNDS.maxY - CAMERA_COLLISION_RADIUS,
    ),
    z: clamp(
      pos.z,
      ROOM_BOUNDS.minZ + CAMERA_COLLISION_RADIUS,
      ROOM_BOUNDS.maxZ - CAMERA_COLLISION_RADIUS,
    ),
  };
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
    const nextPosition = vecAdd(this.position, vecScale(velocity, dt));
    this.position = clampToRoom(
      resolveTvCollision(this.position, nextPosition),
    );

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
