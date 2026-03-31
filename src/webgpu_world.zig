const std = @import("std");

const wasm_alloc = std.heap.wasm_allocator;

const floor_vertices = [_]f32{
    -15.0, 0.0, -10.5,
    15.0,  0.0, -10.5,
    15.0,  0.0, 15.0,
    -15.0, 0.0, -10.5,
    15.0,  0.0, 15.0,
    -15.0, 0.0, 15.0,
};

const tv_frame_vertices = cuboidVertices(
    -3.95,
    3.95,
    0.55,
    3.55,
    -10.35,
    -9.85,
);

const video_quad_vertices = [_]f32{
    -3.4, 3.2, -9.79, 0.0, 0.0,
    3.4,  3.2, -9.79, 1.0, 0.0,
    3.4,  0.9, -9.79, 1.0, 1.0,
    -3.4, 3.2, -9.79, 0.0, 0.0,
    3.4,  0.9, -9.79, 1.0, 1.0,
    -3.4, 0.9, -9.79, 0.0, 1.0,
};

// Theater room: walls + ceiling
// Back wall (behind TV): Z = -10.5, X: -15..+15, Y: 0..6
// Left wall: X = -15, Z: -10.5..+15, Y: 0..6
// Right wall: X = +15, Z: -10.5..+15, Y: 0..6
// Ceiling: Y = 6, X: -15..+15, Z: -10.5..+15
const wall_vertices = [_]f32{
    // Back wall (facing +Z)
    -15.0, 6.0, -10.5, 15.0,  6.0, -10.5, 15.0,  0.0, -10.5,
    -15.0, 6.0, -10.5, 15.0,  0.0, -10.5, -15.0, 0.0, -10.5,
    // Left wall (facing +X)
    -15.0, 6.0, -10.5, -15.0, 6.0, 15.0,  -15.0, 0.0, 15.0,
    -15.0, 6.0, -10.5, -15.0, 0.0, 15.0,  -15.0, 0.0, -10.5,
    // Right wall (facing -X)
    15.0,  6.0, 15.0,  15.0,  6.0, -10.5, 15.0,  0.0, -10.5,
    15.0,  6.0, 15.0,  15.0,  0.0, -10.5, 15.0,  0.0, 15.0,
    // Ceiling (facing -Y)
    -15.0, 6.0, -10.5, 15.0,  6.0, -10.5, 15.0,  6.0, 15.0,
    -15.0, 6.0, -10.5, 15.0,  6.0, 15.0,  -15.0, 6.0, 15.0,
};

// Curtains: two panels flanking the TV screen
// Left curtain: X: -6.5..-4.5, Y: 0..5, Z = -10.2
// Right curtain: X: +4.5..+6.5, Y: 0..5, Z = -10.2
const curtain_vertices = [_]f32{
    // Left curtain
    -6.5, 5.0, -10.2, -4.5, 5.0, -10.2, -4.5, 0.0, -10.2,
    -6.5, 5.0, -10.2, -4.5, 0.0, -10.2, -6.5, 0.0, -10.2,
    // Right curtain
    4.5,  5.0, -10.2, 6.5,  5.0, -10.2, 6.5,  0.0, -10.2,
    4.5,  5.0, -10.2, 6.5,  0.0, -10.2, 4.5,  0.0, -10.2,
};

// Theater seats: 3 rows x 8 seats each
// Each seat is built from 4 cuboids:
//   - Left leg:  thin post
//   - Right leg: thin post
//   - Seat pan:  wide, flat cushion
//   - Backrest:  tall, thin panel behind the cushion
// 4 cuboids * 108 floats = 432 floats per seat
const floats_per_seat = 108 * 4;

fn theaterSeat(comptime cx: f32, comptime row_z: f32) [floats_per_seat]f32 {
    const w: f32 = 0.7; // total seat width
    const leg_w: f32 = 0.06; // leg thickness (x)
    const leg_d: f32 = 0.06; // leg thickness (z)
    const leg_h: f32 = 0.42; // leg height
    const seat_h: f32 = 0.08; // cushion thickness
    const seat_d: f32 = 0.48; // cushion depth (z)
    const back_h: f32 = 0.55; // backrest height above cushion
    const back_d: f32 = 0.06; // backrest thickness (z)

    const seat_top = leg_h + seat_h;

    // Left leg (at back of seat, high Z side)
    const left_leg = cuboidVertices(
        cx,
        cx + leg_w,
        0.0,
        leg_h,
        row_z + seat_d - leg_d,
        row_z + seat_d,
    );
    // Right leg (at back of seat, high Z side)
    const right_leg = cuboidVertices(
        cx + w - leg_w,
        cx + w,
        0.0,
        leg_h,
        row_z + seat_d - leg_d,
        row_z + seat_d,
    );
    // Seat cushion (sits on top of legs, extends forward toward screen)
    const cushion = cuboidVertices(
        cx,
        cx + w,
        leg_h,
        seat_top,
        row_z,
        row_z + seat_d,
    );
    // Backrest (at back edge, high Z side, rises above cushion)
    const backrest = cuboidVertices(
        cx,
        cx + w,
        seat_top,
        seat_top + back_h,
        row_z + seat_d - back_d,
        row_z + seat_d,
    );

    return left_leg ++ right_leg ++ cushion ++ backrest;
}

fn seatRowVertices(comptime row_z: f32) [floats_per_seat * 8]f32 {
    var verts: [floats_per_seat * 8]f32 = undefined;
    const seat_w: f32 = 0.7;
    const gap: f32 = 0.15;
    const total_w = seat_w + gap;
    const start_x: f32 = -3.5 * total_w + total_w * 0.5 - seat_w * 0.5;
    for (0..8) |i| {
        const fi: f32 = @floatFromInt(i);
        const cx = start_x + fi * total_w;
        const seat = theaterSeat(cx, row_z);
        @memcpy(verts[i * floats_per_seat .. (i + 1) * floats_per_seat], &seat);
    }
    return verts;
}

const seat_row_0 = seatRowVertices(2.0);
const seat_row_1 = seatRowVertices(4.5);
const seat_row_2 = seatRowVertices(7.0);
const seat_vertices = seat_row_0 ++ seat_row_1 ++ seat_row_2;

// Movie posters on the left wall (X = -14.95, facing +X)
// Each poster: 2.2 wide (Z) x 3.2 tall (Y), bottom at Y=1.2
// 3 posters spaced along Z: center at Z=-4, Z=2, Z=8
// Vertex format: x, y, z, u, v (5 floats per vertex, 6 verts per quad)
fn posterQuad(comptime z_center: f32) [30]f32 {
    const x: f32 = -14.95;
    const hw: f32 = 1.1; // half-width
    const hh: f32 = 1.6; // half-height
    const cy: f32 = 2.8; // center Y
    const z0 = z_center - hw;
    const z1 = z_center + hw;
    const y0 = cy - hh;
    const y1 = cy + hh;
    return .{
        // tri 1
        x, y1, z0, 1.0, 0.0,
        x, y1, z1, 0.0, 0.0,
        x, y0, z1, 0.0, 1.0,
        // tri 2
        x, y1, z0, 1.0, 0.0,
        x, y0, z1, 0.0, 1.0,
        x, y0, z0, 1.0, 1.0,
    };
}

const poster_0_vertices = posterQuad(-4.0);
const poster_1_vertices = posterQuad(2.0);
const poster_2_vertices = posterQuad(8.0);

// Movie posters on the right wall (X = +14.95, facing -X)
fn rightPosterQuad(comptime z_center: f32) [30]f32 {
    const x: f32 = 14.95;
    const hw: f32 = 1.1;
    const hh: f32 = 1.6;
    const cy: f32 = 2.8;
    const z0 = z_center - hw;
    const z1 = z_center + hw;
    const y0 = cy - hh;
    const y1 = cy + hh;
    // Facing -X: winding order reversed from left wall, UVs correct for viewing
    return .{
        // tri 1
        x, y1, z1, 1.0, 0.0,
        x, y1, z0, 0.0, 0.0,
        x, y0, z0, 0.0, 1.0,
        // tri 2
        x, y1, z1, 1.0, 0.0,
        x, y0, z0, 0.0, 1.0,
        x, y0, z1, 1.0, 1.0,
    };
}

const rposter_0_vertices = rightPosterQuad(-4.0);
const rposter_1_vertices = rightPosterQuad(2.0);
const rposter_2_vertices = rightPosterQuad(8.0);

const scene_wgsl =
    \\struct Camera {
    \\  view_proj: mat4x4<f32>,
    \\};
    \\
    \\@group(0) @binding(0) var<uniform> camera: Camera;
    \\
    \\struct VSIn {
    \\  @location(0) position: vec3<f32>,
    \\};
    \\
    \\struct VSOut {
    \\  @builtin(position) clip_pos: vec4<f32>,
    \\  @location(0) world_pos: vec3<f32>,
    \\};
    \\
    \\@vertex
    \\fn vs_main(input: VSIn) -> VSOut {
    \\  var out: VSOut;
    \\  out.world_pos = input.position;
    \\  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
    \\  return out;
    \\}
    \\
    \\fn checker(uv: vec2<f32>, density: f32) -> f32 {
    \\  let cell = floor(uv * density);
    \\  return fract(cell.x + cell.y);
    \\}
    \\
    \\@fragment
    \\fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
    \\  let base_a = vec3<f32>(0.11, 0.15, 0.2);
    \\  let base_b = vec3<f32>(0.2, 0.27, 0.35);
    \\  let tint = checker(input.world_pos.xz, 0.3);
    \\  var color = mix(base_a, base_b, tint);
    \\
    \\  let major_grid = 1.0 - smoothstep(0.0, 0.06, abs(fract(input.world_pos.x) - 0.5) * 2.0);
    \\  let major_grid_z = 1.0 - smoothstep(0.0, 0.06, abs(fract(input.world_pos.z) - 0.5) * 2.0);
    \\  let grid = max(major_grid, major_grid_z) * 0.15;
    \\  color += vec3<f32>(grid, grid, grid);
    \\
    \\  let axis_x = 1.0 - smoothstep(0.0, 0.06, abs(input.world_pos.x));
    \\  let axis_z = 1.0 - smoothstep(0.0, 0.06, abs(input.world_pos.z));
    \\  color = mix(color, vec3<f32>(0.9, 0.2, 0.1), axis_x * 0.85);
    \\  color = mix(color, vec3<f32>(0.1, 0.5, 0.95), axis_z * 0.85);
    \\
    \\  let dist = length(input.world_pos.xz);
    \\  let fog = clamp(dist / 150.0, 0.0, 1.0);
    \\  color = mix(color, vec3<f32>(0.55, 0.66, 0.78), fog * 0.45);
    \\
    \\  return vec4<f32>(color, 1.0);
    \\}
;

const tv_frame_wgsl =
    \\struct Camera {
    \\  view_proj: mat4x4<f32>,
    \\};
    \\
    \\@group(0) @binding(0) var<uniform> camera: Camera;
    \\
    \\struct VSIn {
    \\  @location(0) position: vec3<f32>,
    \\};
    \\
    \\struct VSOut {
    \\  @builtin(position) clip_pos: vec4<f32>,
    \\  @location(0) world_pos: vec3<f32>,
    \\};
    \\
    \\@vertex
    \\fn vs_main(input: VSIn) -> VSOut {
    \\  var out: VSOut;
    \\  out.world_pos = input.position;
    \\  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
    \\  return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
    \\  let edge = smoothstep(2.8, 3.95, abs(input.world_pos.x));
    \\  let scan = 0.01 * sin(input.world_pos.y * 40.0);
    \\  let base = vec3<f32>(0.02, 0.02, 0.025);
    \\  let glow = vec3<f32>(0.04, 0.05, 0.07) * edge;
    \\  return vec4<f32>(base + glow + vec3<f32>(scan), 1.0);
    \\}
;

const boombox_wgsl =
    \\struct Camera {
    \\  view_proj: mat4x4<f32>,
    \\};
    \\
    \\@group(0) @binding(0) var<uniform> camera: Camera;
    \\
    \\struct VSIn {
    \\  @location(0) position: vec3<f32>,
    \\};
    \\
    \\struct VSOut {
    \\  @builtin(position) clip_pos: vec4<f32>,
    \\  @location(0) world_pos: vec3<f32>,
    \\};
    \\
    \\@vertex
    \\fn vs_main(input: VSIn) -> VSOut {
    \\  var out: VSOut;
    \\  out.world_pos = input.position;
    \\  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
    \\  return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
    \\  let dx = dpdx(input.world_pos);
    \\  let dy = dpdy(input.world_pos);
    \\  let n = normalize(cross(dx, dy));
    \\  let light = normalize(vec3<f32>(0.45, 0.9, 0.35));
    \\  let diffuse = max(dot(n, light), 0.0);
    \\  let ambient = 0.1;
    \\  let shade = ambient + diffuse * 0.3;
    \\  let base = vec3<f32>(0.1, 0.1, 0.12);
    \\  let accent = vec3<f32>(0.18, 0.16, 0.12) * smoothstep(0.0, 1.8, input.world_pos.y);
    \\  return vec4<f32>((base + accent) * shade, 1.0);
    \\}
;

const arch_text_wgsl =
    \\struct Camera {
    \\  view_proj: mat4x4<f32>,
    \\};
    \\
    \\@group(0) @binding(0) var<uniform> camera: Camera;
    \\@group(1) @binding(0) var text_sampler: sampler;
    \\@group(1) @binding(1) var text_tex: texture_2d<f32>;
    \\
    \\struct VSIn {
    \\  @location(0) position: vec3<f32>,
    \\  @location(1) uv: vec2<f32>,
    \\};
    \\
    \\struct VSOut {
    \\  @builtin(position) clip_pos: vec4<f32>,
    \\  @location(0) uv: vec2<f32>,
    \\};
    \\
    \\@vertex
    \\fn vs_main(input: VSIn) -> VSOut {
    \\  var out: VSOut;
    \\  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
    \\  out.uv = input.uv;
    \\  return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
    \\  let c = textureSample(text_tex, text_sampler, input.uv);
    \\  return c;
    \\}
;

const video_wgsl =
    \\struct Camera {
    \\  view_proj: mat4x4<f32>,
    \\};
    \\
    \\@group(0) @binding(0) var<uniform> camera: Camera;
    \\@group(1) @binding(0) var video_sampler: sampler;
    \\@group(1) @binding(1) var video_tex: texture_external;
    \\
    \\struct VSIn {
    \\  @location(0) position: vec3<f32>,
    \\  @location(1) uv: vec2<f32>,
    \\};
    \\
    \\struct VSOut {
    \\  @builtin(position) clip_pos: vec4<f32>,
    \\  @location(0) uv: vec2<f32>,
    \\};
    \\
    \\@vertex
    \\fn vs_main(input: VSIn) -> VSOut {
    \\  var out: VSOut;
    \\  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
    \\  out.uv = input.uv;
    \\  return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
    \\  return textureSampleBaseClampToEdge(video_tex, video_sampler, input.uv);
    \\}
;

const wall_wgsl =
    \\struct Camera {
    \\  view_proj: mat4x4<f32>,
    \\};
    \\struct RoomLight {
    \\  brightness: f32,
    \\};
    \\
    \\@group(0) @binding(0) var<uniform> camera: Camera;
    \\@group(0) @binding(1) var<uniform> room_light: RoomLight;
    \\
    \\struct VSIn {
    \\  @location(0) position: vec3<f32>,
    \\};
    \\
    \\struct VSOut {
    \\  @builtin(position) clip_pos: vec4<f32>,
    \\  @location(0) world_pos: vec3<f32>,
    \\};
    \\
    \\@vertex
    \\fn vs_main(input: VSIn) -> VSOut {
    \\  var out: VSOut;
    \\  out.world_pos = input.position;
    \\  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
    \\  return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
    \\  let dx = dpdx(input.world_pos);
    \\  let dy = dpdy(input.world_pos);
    \\  let n = normalize(cross(dx, dy));
    \\  let light = normalize(vec3<f32>(0.0, 0.8, 0.3));
    \\  let diffuse = max(dot(n, light), 0.0);
    \\  let b = room_light.brightness;
    \\  let shade = mix(0.04, 0.8, b) + diffuse * mix(0.1, 0.9, b);
    \\  let base = vec3<f32>(0.06, 0.055, 0.05);
    \\  var color = base * shade + base * b * 0.4;
    \\  let screen_center = vec3<f32>(0.0, 2.0, -9.8);
    \\  let to_screen = input.world_pos - screen_center;
    \\  let sd = length(to_screen);
    \\  let glow = clamp(1.0 / (1.0 + sd * sd * 0.04), 0.0, 1.0);
    \\  color = color + vec3<f32>(0.08, 0.1, 0.14) * glow * 0.25 * (1.0 - b * 0.8);
    \\  return vec4<f32>(color, 1.0);
    \\}
;

const curtain_wgsl =
    \\struct Camera {
    \\  view_proj: mat4x4<f32>,
    \\};
    \\struct RoomLight {
    \\  brightness: f32,
    \\};
    \\
    \\@group(0) @binding(0) var<uniform> camera: Camera;
    \\@group(0) @binding(1) var<uniform> room_light: RoomLight;
    \\
    \\struct VSIn {
    \\  @location(0) position: vec3<f32>,
    \\};
    \\
    \\struct VSOut {
    \\  @builtin(position) clip_pos: vec4<f32>,
    \\  @location(0) world_pos: vec3<f32>,
    \\};
    \\
    \\@vertex
    \\fn vs_main(input: VSIn) -> VSOut {
    \\  var out: VSOut;
    \\  out.world_pos = input.position;
    \\  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
    \\  return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
    \\  let b = room_light.brightness;
    \\  let fold = 0.5 + 0.5 * sin(input.world_pos.x * 8.0);
    \\  let drape = smoothstep(0.0, 4.5, input.world_pos.y);
    \\  let shade = mix(0.15, 1.0, b) + fold * mix(0.12, 0.4, b) + drape * 0.08;
    \\  let velvet = vec3<f32>(0.55, 0.05, 0.07);
    \\  return vec4<f32>(velvet * shade, 1.0);
    \\}
;

const seat_wgsl =
    \\struct Camera {
    \\  view_proj: mat4x4<f32>,
    \\};
    \\struct RoomLight {
    \\  brightness: f32,
    \\};
    \\
    \\@group(0) @binding(0) var<uniform> camera: Camera;
    \\@group(0) @binding(1) var<uniform> room_light: RoomLight;
    \\
    \\struct VSIn {
    \\  @location(0) position: vec3<f32>,
    \\};
    \\
    \\struct VSOut {
    \\  @builtin(position) clip_pos: vec4<f32>,
    \\  @location(0) world_pos: vec3<f32>,
    \\};
    \\
    \\@vertex
    \\fn vs_main(input: VSIn) -> VSOut {
    \\  var out: VSOut;
    \\  out.world_pos = input.position;
    \\  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
    \\  return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
    \\  let b = room_light.brightness;
    \\  let dx = dpdx(input.world_pos);
    \\  let dy = dpdy(input.world_pos);
    \\  let n = normalize(cross(dx, dy));
    \\  let light = normalize(vec3<f32>(0.0, 0.9, -0.3));
    \\  let diffuse = max(dot(n, light), 0.0);
    \\  let shade = mix(0.08, 0.85, b) + diffuse * mix(0.15, 0.8, b);
    \\  let y = input.world_pos.y;
    \\  let leg_metal = vec3<f32>(0.06, 0.06, 0.07);
    \\  let cushion = vec3<f32>(0.5, 0.06, 0.08);
    \\  let backrest = vec3<f32>(0.45, 0.04, 0.06);
    \\  let is_cushion = smoothstep(0.38, 0.44, y) * (1.0 - smoothstep(0.48, 0.52, y));
    \\  let is_back = smoothstep(0.48, 0.54, y);
    \\  var color = leg_metal;
    \\  color = mix(color, cushion, is_cushion);
    \\  color = mix(color, backrest, is_back);
    \\  return vec4<f32>(color * shade, 1.0);
    \\}
;

const poster_wgsl =
    \\struct Camera {
    \\  view_proj: mat4x4<f32>,
    \\};
    \\struct RoomLight {
    \\  brightness: f32,
    \\};
    \\
    \\@group(0) @binding(0) var<uniform> camera: Camera;
    \\@group(0) @binding(1) var<uniform> room_light: RoomLight;
    \\@group(1) @binding(0) var poster_sampler: sampler;
    \\@group(1) @binding(1) var poster_tex: texture_2d<f32>;
    \\
    \\struct VSIn {
    \\  @location(0) position: vec3<f32>,
    \\  @location(1) uv: vec2<f32>,
    \\};
    \\
    \\struct VSOut {
    \\  @builtin(position) clip_pos: vec4<f32>,
    \\  @location(0) uv: vec2<f32>,
    \\  @location(1) world_pos: vec3<f32>,
    \\};
    \\
    \\@vertex
    \\fn vs_main(input: VSIn) -> VSOut {
    \\  var out: VSOut;
    \\  out.clip_pos = camera.view_proj * vec4<f32>(input.position, 1.0);
    \\  out.uv = input.uv;
    \\  out.world_pos = input.position;
    \\  return out;
    \\}
    \\
    \\@fragment
    \\fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
    \\  let b = room_light.brightness;
    \\  let tex = textureSample(poster_tex, poster_sampler, input.uv);
    \\  let shade = mix(0.12, 0.9, b);
    \\  return vec4<f32>(tex.rgb * shade, tex.a);
    \\}
;

const Vec3 = struct {
    x: f32,
    y: f32,
    z: f32,

    fn add(a: Vec3, b: Vec3) Vec3 {
        return .{ .x = a.x + b.x, .y = a.y + b.y, .z = a.z + b.z };
    }

    fn sub(a: Vec3, b: Vec3) Vec3 {
        return .{ .x = a.x - b.x, .y = a.y - b.y, .z = a.z - b.z };
    }

    fn scale(v: Vec3, s: f32) Vec3 {
        return .{ .x = v.x * s, .y = v.y * s, .z = v.z * s };
    }
};

const CameraState = struct {
    position: Vec3 = .{ .x = 0.0, .y = 1.8, .z = 8.0 },
    yaw: f32 = -std.math.pi / 2.0,
    pitch: f32 = -0.18,
    aspect: f32 = 16.0 / 9.0,
    fov_y: f32 = (65.0 * std.math.pi) / 180.0,
    near: f32 = 0.1,
    far: f32 = 500.0,
};

var camera: CameraState = .{};
var view_proj: [16]f32 = .{
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
};
var camera_position_out: [3]f32 = .{ 0.0, 0.0, 0.0 };
var camera_forward_out: [3]f32 = .{ 0.0, 0.0, -1.0 };
var camera_right_out: [3]f32 = .{ 1.0, 0.0, 0.0 };
var camera_up_out: [3]f32 = .{ 0.0, 1.0, 0.0 };

var last_error_storage: [256]u8 = [_]u8{0} ** 256;
var last_error_length: u32 = 0;

export fn alloc(n: usize) u32 {
    if (n == 0) return 0;
    const buf = wasm_alloc.alloc(u8, n) catch return 0;
    return @intCast(@intFromPtr(buf.ptr));
}

export fn free(ptr: u32, n: usize) void {
    if (ptr == 0 or n == 0) return;
    const raw_ptr: [*]u8 = @ptrFromInt(ptr);
    wasm_alloc.free(raw_ptr[0..n]);
}

export fn wasm2wgsl(input_ptr: u32, input_len: u32) u64 {
    clearLastError();
    if (!looksLikeWasm(input_ptr, input_len)) {
        return 0;
    }

    return allocShaderSource(scene_wgsl) catch {
        setLastError("wasm2wgsl: out of memory");
        return 0;
    };
}

export fn video_shader_wgsl() u64 {
    clearLastError();
    return allocShaderSource(video_wgsl) catch {
        setLastError("video_shader_wgsl: out of memory");
        return 0;
    };
}

export fn tv_frame_shader_wgsl() u64 {
    clearLastError();
    return allocShaderSource(tv_frame_wgsl) catch {
        setLastError("tv_frame_shader_wgsl: out of memory");
        return 0;
    };
}

export fn boombox_shader_wgsl() u64 {
    clearLastError();
    return allocShaderSource(boombox_wgsl) catch {
        setLastError("boombox_shader_wgsl: out of memory");
        return 0;
    };
}

export fn arch_text_shader_wgsl() u64 {
    clearLastError();
    return allocShaderSource(arch_text_wgsl) catch {
        setLastError("arch_text_shader_wgsl: out of memory");
        return 0;
    };
}

export fn wall_shader_wgsl() u64 {
    clearLastError();
    return allocShaderSource(wall_wgsl) catch {
        setLastError("wall_shader_wgsl: out of memory");
        return 0;
    };
}

export fn curtain_shader_wgsl() u64 {
    clearLastError();
    return allocShaderSource(curtain_wgsl) catch {
        setLastError("curtain_shader_wgsl: out of memory");
        return 0;
    };
}

export fn seat_shader_wgsl() u64 {
    clearLastError();
    return allocShaderSource(seat_wgsl) catch {
        setLastError("seat_shader_wgsl: out of memory");
        return 0;
    };
}

// Wall geometry exports
export fn wall_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&wall_vertices[0]));
}
export fn wall_vertex_len() u32 {
    return wall_vertices.len;
}
export fn wall_vertex_count() u32 {
    return wall_vertices.len / 3;
}

// Curtain geometry exports
export fn curtain_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&curtain_vertices[0]));
}
export fn curtain_vertex_len() u32 {
    return curtain_vertices.len;
}
export fn curtain_vertex_count() u32 {
    return curtain_vertices.len / 3;
}

// Seat geometry exports
export fn seat_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&seat_vertices[0]));
}
export fn seat_vertex_len() u32 {
    return seat_vertices.len;
}
export fn seat_vertex_count() u32 {
    return seat_vertices.len / 3;
}

export fn poster_shader_wgsl() u64 {
    clearLastError();
    return allocShaderSource(poster_wgsl) catch {
        setLastError("poster_shader_wgsl: out of memory");
        return 0;
    };
}

// Poster geometry exports (each poster: 6 verts * 5 floats = 30 floats)
export fn poster_0_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&poster_0_vertices[0]));
}
export fn poster_0_vertex_len() u32 {
    return poster_0_vertices.len;
}
export fn poster_1_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&poster_1_vertices[0]));
}
export fn poster_1_vertex_len() u32 {
    return poster_1_vertices.len;
}
export fn poster_2_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&poster_2_vertices[0]));
}
export fn poster_2_vertex_len() u32 {
    return poster_2_vertices.len;
}

// Right wall poster geometry exports
export fn rposter_0_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&rposter_0_vertices[0]));
}
export fn rposter_0_vertex_len() u32 {
    return rposter_0_vertices.len;
}
export fn rposter_1_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&rposter_1_vertices[0]));
}
export fn rposter_1_vertex_len() u32 {
    return rposter_1_vertices.len;
}
export fn rposter_2_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&rposter_2_vertices[0]));
}
export fn rposter_2_vertex_len() u32 {
    return rposter_2_vertices.len;
}

export fn last_error_ptr() u32 {
    return @intCast(@intFromPtr(&last_error_storage[0]));
}

export fn last_error_len() u32 {
    return last_error_length;
}

export fn world_init(width: u32, height: u32) void {
    camera = .{};
    camera.aspect = safeAspect(width, height);
    recomputeViewProjection();
}

export fn world_resize(width: u32, height: u32) void {
    camera.aspect = safeAspect(width, height);
    recomputeViewProjection();
}

export fn world_update(
    dt_seconds: f32,
    move_forward: f32,
    move_right: f32,
    move_up: f32,
    look_delta_x: f32,
    look_delta_y: f32,
    sprint: u32,
) void {
    const dt = clamp(dt_seconds, 0.0, 0.05);
    const mouse_sensitivity: f32 = 0.0025;
    camera.yaw += look_delta_x * mouse_sensitivity;
    camera.pitch += look_delta_y * mouse_sensitivity;
    camera.pitch = clamp(camera.pitch, -1.54, 1.54);

    const forward = cameraForward();
    const world_up = Vec3{ .x = 0.0, .y = 1.0, .z = 0.0 };
    const right_axis = normalize(cross(forward, world_up));

    const base_speed: f32 = if (sprint != 0) 15.0 else 7.0;
    var velocity = Vec3{ .x = 0.0, .y = 0.0, .z = 0.0 };
    velocity = Vec3.add(velocity, Vec3.scale(forward, move_forward * base_speed));
    velocity = Vec3.add(velocity, Vec3.scale(right_axis, move_right * base_speed));
    velocity = Vec3.add(velocity, Vec3.scale(world_up, move_up * base_speed));
    camera.position = Vec3.add(camera.position, Vec3.scale(velocity, dt));

    recomputeViewProjection();
}

export fn camera_matrix_ptr() u32 {
    return @intCast(@intFromPtr(&view_proj[0]));
}

export fn camera_position_ptr() u32 {
    return @intCast(@intFromPtr(&camera_position_out[0]));
}

export fn camera_forward_ptr() u32 {
    return @intCast(@intFromPtr(&camera_forward_out[0]));
}

export fn camera_right_ptr() u32 {
    return @intCast(@intFromPtr(&camera_right_out[0]));
}

export fn camera_up_ptr() u32 {
    return @intCast(@intFromPtr(&camera_up_out[0]));
}

export fn floor_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&floor_vertices[0]));
}

export fn floor_vertex_len() u32 {
    return floor_vertices.len;
}

export fn floor_vertex_count() u32 {
    return floor_vertices.len / 3;
}

export fn tv_frame_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&tv_frame_vertices[0]));
}

export fn tv_frame_vertex_len() u32 {
    return tv_frame_vertices.len;
}

export fn tv_frame_vertex_count() u32 {
    return tv_frame_vertices.len / 3;
}

export fn video_vertex_ptr() u32 {
    return @intCast(@intFromPtr(&video_quad_vertices[0]));
}

export fn video_vertex_len() u32 {
    return video_quad_vertices.len;
}

export fn video_vertex_count() u32 {
    return video_quad_vertices.len / 5;
}

fn allocShaderSource(source: []const u8) !u64 {
    const out = try wasm_alloc.alloc(u8, source.len);
    @memcpy(out, source);

    const ptr_u32: u32 = @intCast(@intFromPtr(out.ptr));
    const len_u32: u32 = @intCast(out.len);
    return (@as(u64, len_u32) << 32) | @as(u64, ptr_u32);
}

fn cuboidVertices(
    x_min: f32,
    x_max: f32,
    y_min: f32,
    y_max: f32,
    z_min: f32,
    z_max: f32,
) [108]f32 {
    return .{
        // Front
        x_min, y_max, z_max, x_max, y_max, z_max, x_max, y_min, z_max,
        x_min, y_max, z_max, x_max, y_min, z_max, x_min, y_min, z_max,
        // Back
        x_max, y_max, z_min, x_min, y_max, z_min, x_min, y_min, z_min,
        x_max, y_max, z_min, x_min, y_min, z_min, x_max, y_min, z_min,
        // Left
        x_min, y_max, z_min, x_min, y_max, z_max, x_min, y_min, z_max,
        x_min, y_max, z_min, x_min, y_min, z_max, x_min, y_min, z_min,
        // Right
        x_max, y_max, z_max, x_max, y_max, z_min, x_max, y_min, z_min,
        x_max, y_max, z_max, x_max, y_min, z_min, x_max, y_min, z_max,
        // Top
        x_min, y_max, z_min, x_max, y_max, z_min, x_max, y_max, z_max,
        x_min, y_max, z_min, x_max, y_max, z_max, x_min, y_max, z_max,
        // Bottom
        x_min, y_min, z_max, x_max, y_min, z_max, x_max, y_min, z_min,
        x_min, y_min, z_max, x_max, y_min, z_min, x_min, y_min, z_min,
    };
}

fn looksLikeWasm(input_ptr: u32, input_len: u32) bool {
    if (input_ptr == 0) {
        setLastError("wasm2wgsl: input pointer is null");
        return false;
    }
    if (input_len < 8) {
        setLastError("wasm2wgsl: input is shorter than a wasm header");
        return false;
    }
    const input_raw: [*]const u8 = @ptrFromInt(input_ptr);
    const bytes = input_raw[0..input_len];
    if (bytes[0] != 0x00 or bytes[1] != 'a' or bytes[2] != 's' or bytes[3] != 'm') {
        setLastError("wasm2wgsl: bad wasm magic");
        return false;
    }
    if (bytes[4] != 0x01 or bytes[5] != 0x00 or bytes[6] != 0x00 or bytes[7] != 0x00) {
        setLastError("wasm2wgsl: unsupported wasm version");
        return false;
    }
    return true;
}

fn clearLastError() void {
    last_error_length = 0;
    @memset(last_error_storage[0..], 0);
}

fn setLastError(message: []const u8) void {
    const truncated_len = @min(message.len, last_error_storage.len - 1);
    @memcpy(last_error_storage[0..truncated_len], message[0..truncated_len]);
    last_error_storage[truncated_len] = 0;
    last_error_length = @intCast(truncated_len);
}

fn safeAspect(width: u32, height: u32) f32 {
    const safe_width: u32 = @max(width, 1);
    const safe_height: u32 = @max(height, 1);
    return @as(f32, @floatFromInt(safe_width)) / @as(f32, @floatFromInt(safe_height));
}

fn recomputeViewProjection() void {
    const forward = cameraForward();
    const up = Vec3{ .x = 0.0, .y = 1.0, .z = 0.0 };
    const right = normalize(cross(forward, up));
    const camera_up = normalize(cross(right, forward));
    const target = Vec3.add(camera.position, forward);
    const view = lookAtRH(camera.position, target, up);
    const proj = perspectiveRH(camera.fov_y, camera.aspect, camera.near, camera.far);
    view_proj = mulMat4(proj, view);
    camera_position_out = .{ camera.position.x, camera.position.y, camera.position.z };
    camera_forward_out = .{ forward.x, forward.y, forward.z };
    camera_right_out = .{ right.x, right.y, right.z };
    camera_up_out = .{ camera_up.x, camera_up.y, camera_up.z };
}

fn cameraForward() Vec3 {
    const cp = @cos(camera.pitch);
    const sp = @sin(camera.pitch);
    const cy = @cos(camera.yaw);
    const sy = @sin(camera.yaw);
    return normalize(.{
        .x = cy * cp,
        .y = sp,
        .z = sy * cp,
    });
}

fn dot(a: Vec3, b: Vec3) f32 {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

fn cross(a: Vec3, b: Vec3) Vec3 {
    return .{
        .x = a.y * b.z - a.z * b.y,
        .y = a.z * b.x - a.x * b.z,
        .z = a.x * b.y - a.y * b.x,
    };
}

fn length(v: Vec3) f32 {
    return @sqrt(dot(v, v));
}

fn normalize(v: Vec3) Vec3 {
    const len = length(v);
    if (len <= 0.00001) return .{ .x = 0.0, .y = 0.0, .z = 0.0 };
    return Vec3.scale(v, 1.0 / len);
}

fn clamp(v: f32, min_v: f32, max_v: f32) f32 {
    if (v < min_v) return min_v;
    if (v > max_v) return max_v;
    return v;
}

fn perspectiveRH(fov_y: f32, aspect: f32, near: f32, far: f32) [16]f32 {
    const tan_half = @tan(fov_y * 0.5);
    const f = 1.0 / tan_half;
    const range_inv = 1.0 / (near - far);

    var out: [16]f32 = [_]f32{0.0} ** 16;
    out[0] = f / aspect;
    out[5] = f;
    out[10] = far * range_inv;
    out[11] = -1.0;
    out[14] = far * near * range_inv;
    return out;
}

fn lookAtRH(eye: Vec3, center: Vec3, up_hint: Vec3) [16]f32 {
    const f = normalize(Vec3.sub(center, eye));
    const s = normalize(cross(f, up_hint));
    const u = cross(s, f);

    return .{
        s.x,          u.x,          -f.x,        0.0,
        s.y,          u.y,          -f.y,        0.0,
        s.z,          u.z,          -f.z,        0.0,
        -dot(s, eye), -dot(u, eye), dot(f, eye), 1.0,
    };
}

fn mulMat4(a: [16]f32, b: [16]f32) [16]f32 {
    var out: [16]f32 = [_]f32{0.0} ** 16;
    var col: usize = 0;
    while (col < 4) : (col += 1) {
        var row: usize = 0;
        while (row < 4) : (row += 1) {
            var sum: f32 = 0.0;
            var k: usize = 0;
            while (k < 4) : (k += 1) {
                sum += a[(k * 4) + row] * b[(col * 4) + k];
            }
            out[(col * 4) + row] = sum;
        }
    }
    return out;
}
