import fs from "node:fs/promises";
import path from "node:path";

const destDir = path.resolve("web/public");
const wasmSource = path.resolve("zig-out/web/webgpu_world.wasm");
const wasmDest = path.join(destDir, "webgpu_world.wasm");
const assetCopies = [
  {
    source: path.resolve("BoomBox.fbx"),
    dest: path.join(destDir, "BoomBox.fbx"),
  },
  {
    source: path.resolve("tape.glb"),
    dest: path.join(destDir, "tape.glb"),
  },
  {
    source: path.resolve("player.glb"),
    dest: path.join(destDir, "player.glb"),
  },
];

await fs.mkdir(destDir, { recursive: true });
await fs.copyFile(wasmSource, wasmDest);
console.log(`Copied ${wasmSource} -> ${wasmDest}`);

for (const asset of assetCopies) {
  await fs.copyFile(asset.source, asset.dest);
  console.log(`Copied ${asset.source} -> ${asset.dest}`);
}
