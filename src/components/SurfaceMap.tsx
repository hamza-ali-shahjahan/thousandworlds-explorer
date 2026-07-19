import { useEffect, useRef } from 'react';
import './SurfaceMap.css';
import { climateRgb } from '../lib/climate';

// Spatial surface-temperature map for one simulated world. Renders the 32x64 lat-lon
// field (packed in tw-surface.u8, uint8: 0 = missing, 1..255 = linear over kRange) to a
// canvas heatmap, colored with the continuous frozen -> temperate -> scorching ramp
// (lib/climate.ts) anchored on the scatter dots' hues, so a red dot opens into a
// red-hot surface AND within-regime structure stays visible.

export interface FieldMeta {
  name: string;
  grid: [number, number];      // [rows(lat), cols(lon)]
  kRange: [number, number];    // [lo, hi] kelvin
  sentinel: number;            // value meaning "missing"
  asset: string;
}

// Backing resolution per mode — CSS scales the canvas to its container; smoothing does the
// interpolation, so the 32x64 grid reads as a smooth field rather than blocky pixels.
const RES = { thumb: [512, 256], hero: [1024, 512] } as const;

export default function SurfaceMap({ data, row, grid, kRange, size }: {
  data: Uint8Array | null;
  row: number | null;
  grid: [number, number];
  kRange: [number, number];
  size: 'thumb' | 'hero';
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [W, H] = RES[size];

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dctx = cv.getContext('2d');
    if (!dctx) return;
    if (!data || row == null) { dctx.clearRect(0, 0, W, H); return; }

    const [rows, cols] = grid;          // 32 x 64
    const [lo, hi] = kRange;
    const off = row * rows * cols;

    // paint the native-resolution field into a small offscreen canvas...
    const src = document.createElement('canvas');
    src.width = cols; src.height = rows;
    const sctx = src.getContext('2d');
    if (!sctx) return;
    const img = sctx.createImageData(cols, rows);
    for (let i = 0; i < rows * cols; i++) {
      const u = data[off + i];
      let r = 16, g = 20, b = 34;        // missing/sentinel -> near-background dark
      if (u !== 0) {
        const t = lo + ((u - 1) / 254) * (hi - lo);
        [r, g, b] = climateRgb(t);
      }
      const p = i * 4;
      img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);

    // ...then blit it scaled-up with smoothing.
    dctx.imageSmoothingEnabled = true;
    (dctx as CanvasRenderingContext2D & { imageSmoothingQuality?: string }).imageSmoothingQuality = 'high';
    dctx.clearRect(0, 0, W, H);
    dctx.drawImage(src, 0, 0, W, H);
  }, [data, row, grid, kRange, W, H]);

  return <canvas ref={ref} className={`surfacemap ${size}`} width={W} height={H} aria-label="Surface temperature map" role="img" />;
}
