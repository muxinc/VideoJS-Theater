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
  {
    source: path.resolve("twoOldPeople.png"),
    dest: path.join(destDir, "twoOldPeople.png"),
  },
  {
    source: path.resolve("catzilla.png"),
    dest: path.join(destDir, "catzilla.png"),
  },
  {
    source: path.resolve("bunny.jpg"),
    dest: path.join(destDir, "bunny.jpg"),
  },
  {
    source: path.resolve("water.png"),
    dest: path.join(destDir, "water.png"),
  },
  {
    source: path.resolve("mediachrome.png"),
    dest: path.join(destDir, "mediachrome.png"),
  },
  {
    source: path.resolve("muxrobots.png"),
    dest: path.join(destDir, "muxrobots.png"),
  },
];

await fs.mkdir(destDir, { recursive: true });
await fs.copyFile(wasmSource, wasmDest);
console.log(`Copied ${wasmSource} -> ${wasmDest}`);

for (const asset of assetCopies) {
  await fs.copyFile(asset.source, asset.dest);
  console.log(`Copied ${asset.source} -> ${asset.dest}`);
}
