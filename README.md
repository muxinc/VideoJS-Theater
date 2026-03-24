# Zig WebGPU World

This project builds a browser WebGPU scene where:

- Zig (compiled to WASM) owns world state, camera math, floor mesh data, and WGSL emission.
- JavaScript only handles browser APIs: WASM loading, WebGPU setup, input events, and frame submission.
- Video playback is rendered onto a quad inside the 3D scene with a 3D TV-style frame around it.
- `BoomBox.fbx` is loaded at runtime and rendered on the floor near the TV.
- `tape.glb` is loaded at runtime and rendered on the floor near the TV screen.
- `player.glb` is loaded at runtime and rendered on the floor in front of the TV.
- A curved 3D banner above the TV reads `VJS 10 Theater`.

## Install

```bash
npm install
```

## Run Dev Server

```bash
npm run dev
```

This script:

- builds Zig WASM via `zig build wasm`
- copies `zig-out/web/webgpu_world.wasm` into `web/public/`
- starts Vite with `web/` as app root

## Build Production

```bash
npm run build
```

Build output:

- `zig-out/web/index.html`
- `zig-out/web/assets/*`
- `zig-out/web/webgpu_world.wasm`

## Controls

- Move: `W A S D`
- Up/Down: `E / Q`
- Sprint: `Shift`
- Look: mouse (click canvas or `Lock Cursor` button for pointer lock)
- In-world video: use `Play Video` / `Pause Video` buttons

## Video.js v10 (React)

- Uses `@videojs/react@next` from npm in `web/src/videojs-player-host.js`.
- Renders a hidden `createPlayer(...).Provider` + `VideoSkin` + `Video` tree and reuses the rendered `<video>` element as the WebGPU video texture source.
# pose
