import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    // Self-host the onnxruntime-web WASM runtime for the PCA-GBT emulator — served at
    // /ort/ in dev and copied into dist/ort/ on build, so it stays offline with no CDN
    // dependency. ORT 1.27 resolves to the `.jsep` build by default, so copy the whole
    // ort-wasm-simd-threaded* family (plain + jsep) — copying only the plain file made
    // ORT 404 on ort-wasm-simd-threaded.jsep.mjs → "no available backend" → silent kNN
    // fallback. Files are fetched on demand, so the extra variants don't cost load time.
    viteStaticCopy({
      targets: [
        { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*.{wasm,mjs}', dest: 'ort' },
      ],
    }),
  ],
  server: { port: 5173, strictPort: false, open: false },
});
