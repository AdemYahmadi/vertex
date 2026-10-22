import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Let Vite emit onnxruntime-web's wasm as an asset instead of pre-bundling.
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  worker: { format: "es" },
});
