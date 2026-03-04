const path = require("node:path");
const { defineConfig } = require("vite");

module.exports = defineConfig({
  root: path.resolve(__dirname),
  build: {
    outDir: "../zig-out/web",
    emptyOutDir: true,
  },
});
