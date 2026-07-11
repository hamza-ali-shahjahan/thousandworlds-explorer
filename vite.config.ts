import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    // Self-host the onnxruntime-web WASM runtime for the PCA-GBT emulator — served at
    // /ort/ in dev and copied into dist/ort/ on build, so it stays offline with no CDN
    // dependency. The app imports `onnxruntime-web/wasm` (CPU-only), whose bundle
    // requests ONLY the plain ort-wasm-simd-threaded.{wasm,mjs} pair — the jsep/
    // asyncify/jspi variants (63 MB combined) belong to other entry points and are
    // never fetched, so copying them only bloated dist. (The old jsep 404 happened
    // under the full `onnxruntime-web` import, before the /wasm switch.)
    viteStaticCopy({
      targets: [
        { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{wasm,mjs}', dest: 'ort' },
      ],
    }),
  ],
  server: { port: 5173, strictPort: false, open: false },
});
