# I Put a TV Inside a GPU and Played HLS on It (with Zig, WASM, React, and Video.js)

You know that feeling when you look at a perfectly reasonable tech stack and think, "What if I made this weirder?" That's basically how this project started.

**The idea:** Build a first-person 3D world rendered entirely with WebGPU, where a virtual TV screen plays back a real HLS video stream -- powered by Zig compiled to WebAssembly, with Video.js v10's React bindings running *completely hidden* off-screen just to get a `<video>` element that feeds frames into a GPU shader.

Yeah. Let's talk about it.

---

## The Architecture (A.K.A. "Why Does This Work?")

Here's the 10,000-foot view:

```
Zig (compile time)
  └─ webgpu_world.zig
       ├─ 5 WGSL shaders (embedded as strings)
       ├─ Floor / TV / Video geometry (comptime arrays)
       ├─ Camera state + linear algebra (Vec3, Mat4)
       └─ Memory allocator for JS ↔ WASM communication
              │
              │ zig build wasm → 17.8 KB (!!)
              ▼
Browser (runtime)
  ├─ React (hidden off-screen) → Video.js v10 → <video> element
  ├─ WebAssembly (camera math, world state)
  └─ WebGPU (rendering everything, including video frames as textures)
```

The whole WASM binary is **17,876 bytes**. That's smaller than most favicons. It contains a full camera system, five GPU shaders, 3D geometry, a memory allocator, and enough linear algebra to make a math professor nod approvingly.

---

## Part 1: Zig as the Brain

### Compiling to WASM

The `build.zig` file does the heavy lifting. The key bit is the WASM target configuration:

```zig
const wasm_target = b.resolveTargetQuery(.{
    .cpu_arch = .wasm32,
    .os_tag = .freestanding,
});
const wasm_module = b.createModule(.{
    .root_source_file = b.path("src/webgpu_world.zig"),
    .target = wasm_target,
    .optimize = .ReleaseSmall,
    .strip = true,
});
const wasm_exe = b.addExecutable(.{
    .name = "webgpu_world",
    .root_module = wasm_module,
});
wasm_exe.entry = .disabled;
wasm_exe.rdynamic = true;
```

Let's unpack what makes this special:

- **`.cpu_arch = .wasm32, .os_tag = .freestanding`** -- No OS, no libc, no syscalls. This is a bare-metal WASM module. Zig doesn't need an OS to do math.
- **`.optimize = .ReleaseSmall` + `.strip = true`** -- This is how you get a 17 KB binary. Zig aggressively dead-code-eliminates everything you don't use.
- **`.entry = .disabled`** -- There's no `main()`. This isn't a program, it's a library. JavaScript calls the shots.
- **`.rdynamic = true`** -- This is the crucial one. It exports every `export fn` so JavaScript can see and call them. Without this, your WASM module is a very small, very useless file.

### Shaders Written in... Zig?

Well, sort of. The WGSL shader source code lives as multiline string literals inside `webgpu_world.zig`. Zig's `\\` multiline syntax makes this surprisingly ergonomic:

```zig
const video_wgsl =
    \\struct Camera {
    \\  view_proj: mat4x4<f32>,
    \\};
    \\
    \\@group(0) @binding(0) var<uniform> camera: Camera;
    \\@group(1) @binding(0) var video_sampler: sampler;
    \\@group(1) @binding(1) var video_tex: texture_external;
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
```

See that `texture_external` type? That's WebGPU's way of saying "this texture comes from outside the GPU pipeline" -- in our case, live video frames from an HLS stream. And `textureSampleBaseClampToEdge` is the *only* legal sampling function for external textures. WebGPU is strict about this stuff, and honestly, I respect it.

There are five shaders total, each handling a different part of the scene: the ground floor (with a checkerboard pattern and fog), the TV cabinet (with edge glow and scan lines), the boombox model, the arch banner text, and the video quad itself. All defined in Zig, all compiled into the WASM binary as static data.

### Comptime Geometry Generation

Here's where Zig flexes. The TV cabinet is a cuboid, and generating all 36 vertices (12 triangles, 6 faces) for a box is tedious. So why not make the compiler do it?

```zig
const tv_frame_vertices = cuboidVertices(
    -3.95, 3.95,   // x range
     0.55, 3.55,   // y range
    -10.35, -9.85, // z range
);

fn cuboidVertices(
    x_min: f32, x_max: f32,
    y_min: f32, y_max: f32,
    z_min: f32, z_max: f32,
) [108]f32 {
    return .{
        // Front face
        x_min, y_max, z_max, x_max, y_max, z_max, x_max, y_min, z_max,
        x_min, y_max, z_max, x_max, y_min, z_max, x_min, y_min, z_max,
        // Back face
        x_max, y_max, z_min, x_min, y_max, z_min, x_min, y_min, z_min,
        x_max, y_max, z_min, x_min, y_min, z_min, x_max, y_min, z_min,
        // ... 4 more faces
    };
}
```

This function runs entirely at compile time. The Zig compiler evaluates it, and the WASM binary contains the final 108 floats as static data. Zero runtime cost. Zero allocation. Just vibes and vertex data.

### The Packed u64 Trick

WASM functions can only return scalar values -- no structs, no tuples, no multiple return values. So how do you return a pointer *and* a length from a function? You stuff them both into one `u64`:

```zig
fn allocShaderSource(source: []const u8) !u64 {
    const out = try wasm_alloc.alloc(u8, source.len);
    @memcpy(out, source);

    const ptr_u32: u32 = @intCast(@intFromPtr(out.ptr));
    const len_u32: u32 = @intCast(out.len);
    return (@as(u64, len_u32) << 32) | @as(u64, ptr_u32);
}
```

Lower 32 bits = pointer. Upper 32 bits = length. It's the WASM equivalent of smuggling two kids into a movie theater under one trenchcoat.

JavaScript unpacks it on the other side with BigInt arithmetic:

```javascript
function unpackResult(packed) {
  const value = BigInt(packed);
  const ptr = Number(value & 0xffffffffn);
  const len = Number((value >> 32n) & 0xffffffffn);
  return { ptr, len };
}
```

Simple? Yes. Elegant? Debatable. Does it work? Absolutely.

### Hand-Rolled Linear Algebra

The camera system is a complete first-person controller with yaw/pitch mouse look, WASD movement, sprint, and a proper perspective projection. And it's all hand-written in Zig with zero dependencies:

```zig
const CameraState = struct {
    position: Vec3 = .{ .x = 0.0, .y = 1.8, .z = 8.0 },
    yaw: f32 = -std.math.pi / 2.0,
    pitch: f32 = -0.18,
    aspect: f32 = 16.0 / 9.0,
    fov_y: f32 = (65.0 * std.math.pi) / 180.0,
    near: f32 = 0.1,
    far: f32 = 500.0,
};

export fn world_update(
    dt_seconds: f32,
    move_forward: f32, move_right: f32, move_up: f32,
    look_delta_x: f32, look_delta_y: f32,
    sprint: u32,
) void {
    const dt = clamp(dt_seconds, 0.0, 0.05);
    camera.yaw += look_delta_x * 0.0025;
    camera.pitch = clamp(camera.pitch + look_delta_y * 0.0025, -1.54, 1.54);

    const forward = cameraForward();
    const right_axis = normalize(cross(forward, Vec3{ .x = 0, .y = 1, .z = 0 }));
    const base_speed: f32 = if (sprint != 0) 15.0 else 7.0;

    var velocity = Vec3{ .x = 0, .y = 0, .z = 0 };
    velocity = Vec3.add(velocity, Vec3.scale(forward, move_forward * base_speed));
    velocity = Vec3.add(velocity, Vec3.scale(right_axis, move_right * base_speed));
    camera.position = Vec3.add(camera.position, Vec3.scale(velocity, dt));

    recomputeViewProjection();
}
```

Every frame, JavaScript sends input deltas into WASM. Zig computes the new camera state, builds a 4x4 view-projection matrix via `perspectiveRH` and `lookAtRH`, and stores it in WASM linear memory. JavaScript reads the matrix out and uploads it to the GPU. The whole camera pipeline -- input processing, trig, matrix math -- happens in WASM. JavaScript never touches a sine function.

---

## Part 2: The WASM Bridge

Loading the WASM module is refreshingly simple:

```javascript
async function instantiateZigWasm(url) {
  if (WebAssembly.instantiateStreaming) {
    const streamResponse = await fetch(url);
    try {
      return await WebAssembly.instantiateStreaming(streamResponse, {});
    } catch { /* fallback */ }
  }
  const response = await fetch(url);
  const bytes = await response.arrayBuffer();
  return await WebAssembly.instantiate(bytes, {});
}
```

Notice the `{}` -- an empty imports object. The WASM module needs *nothing* from JavaScript. No callbacks, no function imports, no shared memory setup. All communication is one-directional: JavaScript calls WASM exports and reads WASM memory. This is the dream of a clean API boundary.

Using it in the render loop looks like this:

```javascript
const { instance } = await instantiateZigWasm("./webgpu_world.wasm");
const wasm = instance.exports;

// Every frame:
wasm.world_update(dt, forward, right, up, lookX, lookY, sprint);

// Read the 4x4 camera matrix directly from WASM memory
cameraValues.set(
  new Float32Array(wasm.memory.buffer, wasm.camera_matrix_ptr(), 16)
);
device.queue.writeBuffer(cameraBuffer, 0, cameraValues);
```

`wasm.memory.buffer` is the raw WASM linear memory. We're creating a `Float32Array` view directly over it -- no copies, no serialization, no JSON. Just raw floats being read from one address space and shipped to the GPU. This is what peak interop looks like.

---

## Part 3: React, but Make It Invisible

Here's where things get philosophically interesting. React is being used in this project. But you'll never see it.

The entire React component tree renders into a hidden container that's positioned 9999 pixels off-screen:

```css
.video-hidden {
  position: absolute;
  left: -9999px;
  top: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
```

Why? Because we need Video.js v10's React bindings to set up a proper HLS player -- with adaptive bitrate switching, protocol handling, and all the battle-tested media pipeline logic that comes with it. But we don't need its *UI*. The 3D scene rendered by WebGPU *is* the UI.

The Video.js player host uses `createElement` directly (no JSX, no build step for React):

```javascript
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createPlayer, videoFeatures } from "@videojs/react";
import { Video, VideoSkin } from "@videojs/react/video";

const Player = createPlayer({ features: videoFeatures });

root.render(
  createElement(
    Player.Provider,
    null,
    createElement(
      VideoSkin,
      null,
      createElement(Video, {
        ref: (element) => { videoRef = element; },
        src: "https://stream.mux.com/...m3u8",
        poster: "https://image.mux.com/.../storyboard.png",
        preload: "auto",
        muted: false,
        loop: true,
        playsInline: true,
        controls: true,
        crossOrigin: "anonymous",
      }),
    ),
  ),
);
```

The `ref` callback is doing the important work -- it captures the underlying `<video>` DOM element that Video.js creates. That element is the golden ticket. It's what we'll feed to WebGPU.

But there's a catch: React renders asynchronously. The `<video>` element doesn't exist immediately after `root.render()`. So the code polls with `requestAnimationFrame` until it shows up:

```javascript
return await new Promise((resolve, reject) => {
  const check = () => {
    const videoElement = getVideoElement(host, videoRef);
    if (videoElement) {
      configureVideoElement(videoElement, src, poster);
      resolve({ videoElement, getVideoElement: () => getVideoElement(host, videoRef) });
      return;
    }
    if (performance.now() - start >= timeoutMs) {
      reject(new Error("Timed out while waiting for Video.js media element"));
      return;
    }
    requestAnimationFrame(check);
  };
  check();
});
```

It returns both the element *and* a getter function. Why the getter? Because Video.js might *replace* the `<video>` element during source changes (like when switching HLS renditions). Every frame, the render loop defensively checks:

```javascript
const activeVideoElement = getMountedVideoElement?.();
if (activeVideoElement instanceof HTMLVideoElement && activeVideoElement !== videoElement) {
  videoElement = activeVideoElement;
  videoElement.muted = false;
  videoElement.playsInline = true;
  videoElement.loop = true;
}
```

Paranoid? Maybe. Robust? Definitely.

---

## Part 4: Video.js Meets WebGPU

This is the payoff. The moment where a Mux HLS stream, decoded by Video.js, becomes a texture on a virtual TV screen inside a WebGPU-rendered 3D world.

```javascript
if (
  videoRenderEnabled &&
  videoElement.readyState >= 2 &&
  videoElement.videoWidth > 0 &&
  videoElement.videoHeight > 0 &&
  !videoElement.paused
) {
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
}
```

`device.importExternalTexture({ source: videoElement })` is the magic line. WebGPU takes the `<video>` element's current frame and turns it into a GPU-readable texture -- with zero CPU-side pixel copies. The browser handles the video decode → GPU texture pipeline natively.

The bind group *must* be recreated every frame because external textures are ephemeral by spec. Each call to `importExternalTexture` gives you a handle that's only valid for the current frame. It's a bit of boilerplate, but the performance is worth it -- you're getting hardware-accelerated video decode directly into a GPU texture.

The vertex data for the video quad comes from Zig:

```zig
const video_quad_vertices = [_]f32{
    -3.4, 3.2, -9.79, 0.0, 0.0,   // top-left: position + UV
     3.4, 3.2, -9.79, 1.0, 0.0,   // top-right
     3.4, 0.9, -9.79, 1.0, 1.0,   // bottom-right
    -3.4, 3.2, -9.79, 0.0, 0.0,   // top-left (second triangle)
     3.4, 0.9, -9.79, 1.0, 1.0,   // bottom-right
    -3.4, 0.9, -9.79, 0.0, 1.0,   // bottom-left
};
```

Two triangles forming a rectangle at `z = -9.79` (just in front of the TV cabinet at `z = -9.85`). The UV coordinates map the full video frame onto the quad. Simple, explicit, no surprises.

---

## The Build Pipeline

The whole thing ties together with a three-stage build:

```json
{
  "scripts": {
    "wasm:sync": "zig build wasm && node scripts/sync-wasm.mjs",
    "dev": "npm run wasm:sync && vite --config web/vite.config.js",
    "build": "npm run wasm:sync && vite build --config web/vite.config.js"
  }
}
```

1. `zig build wasm` -- Zig compiles `webgpu_world.zig` to a 17 KB WASM binary
2. `sync-wasm.mjs` -- Copies the WASM + 3D model assets into `web/public/`
3. Vite -- Bundles the JavaScript, serves in dev, or builds for production

Every `npm run dev` rebuilds the WASM from scratch. The Zig compilation is fast enough that this is a non-issue -- we're talking sub-second builds for a module this size.

---

## What I Learned

**Zig is an incredibly good WASM target.** The combination of `comptime` evaluation, zero-overhead abstractions, and a built-in WASM allocator means you can write code that's simultaneously high-level and tiny. 602 lines of Zig produces an 18 KB binary that handles shaders, geometry, camera math, and memory management.

**The WASM ↔ JavaScript boundary can be clean.** Zero imports. Export functions. Read memory. That's the whole API. No wasm-bindgen, no glue code generators, no multi-megabyte JavaScript loaders. Just function calls and raw memory.

**Video.js v10's React API is composable enough to use headlessly.** Rendering a full `Player.Provider > VideoSkin > Video` tree into an invisible container just to get a `<video>` element might sound unhinged, but it means you get HLS support, adaptive bitrate, and a battle-tested media pipeline without reinventing any of it.

**WebGPU's `importExternalTexture` is the real hero.** Zero-copy video frames on the GPU. The browser handles the decode pipeline. You just sample the texture in your shader and move on with your life.

**And finally:** Sometimes the best architecture is the one where each technology does exactly one thing well, and you glue them together with as little ceremony as possible. Zig owns the math. React owns the player. WebGPU owns the pixels. Everyone stays in their lane.

The result? A 3D theater where you can walk around and watch HLS video on a virtual TV. Is it practical? That's not the point. The point is that it *works*, and understanding *why* it works teaches you something real about every layer of the stack.

---

*Built with Zig 0.15.2, Video.js 10 (alpha), React 19, WebGPU, and questionable architectural instincts.*
