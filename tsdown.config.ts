import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "index.ts", globals: "globals.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  dts: true,
  clean: true,
  define: {
    __HOSTFRAME_ADDON__: JSON.stringify("./hostframe.node")
  },
  outputOptions: {
    entryFileNames: "[name].js"
  }
});
