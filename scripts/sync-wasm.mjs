import fs from "node:fs/promises";
import path from "node:path";

const destDir = path.resolve("web/public");
const wasmSource = path.resolve("zig-out/web/webgpu_world.wasm");
const wasmDest = path.join(destDir, "webgpu_world.wasm");
const boomboxSource = path.resolve("BoomBox.fbx");
const boomboxDest = path.join(destDir, "BoomBox.fbx");

await fs.mkdir(destDir, { recursive: true });
await fs.copyFile(wasmSource, wasmDest);
await fs.copyFile(boomboxSource, boomboxDest);
console.log(`Copied ${wasmSource} -> ${wasmDest}`);
console.log(`Copied ${boomboxSource} -> ${boomboxDest}`);
