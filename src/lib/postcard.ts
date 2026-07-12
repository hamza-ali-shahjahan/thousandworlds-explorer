import { kToC, n } from './util';

// "Postcard from your world" — composes a 1200×900 retro travel-poster PNG for
// a planet's physically modeled portrait and triggers a download. The climate
// field is drawn with the SAME colormap as SurfaceMap, but upscaled with
// smoothing OFF: the honest 64×32-pixel look, not a faked hi-res render.
// Pure text/color helpers are exported separately so they can be unit-tested
// in node (no DOM outside downloadPostcard itself).

const W = 1200, H = 900;

// Local copy of the shared climate colormap (matches SurfaceMap.tsx tColor /
// ThousandWorlds.tsx / ImagineLab.tsx): frozen → cold → temperate → hot → scorching.
export function climateRgb(t: number): [number, number, number] {
  if (t < 240) return [0x6f, 0xa8, 0xff];   // snowball
  if (t < 273) return [0x7f, 0xcf, 0xe6];   // cold
  if (t < 320) return [0x46, 0xd4, 0x9a];   // temperate (liquid-water band)
  if (t < 373) return [0xf0, 0xb2, 0x4a];   // hot
  return [0xe2, 0x4b, 0x4a];                // scorching / steam
}

// Cheeky-but-honest packing advice from the area-weighted global mean (same
// band edges as the regime strip: 240 / 273 / 320 / 373 K).
export function postcardStat(meanK: number): string {
  if (!Number.isFinite(meanK)) return 'Average surface: unknown. Pack everything.';
  const c = kToC(meanK);
  if (meanK < 240) return `Average surface: ${c}. Pack a parka — and bring the sun.`;
  if (meanK < 273) return `Average surface: ${c}. Bring layers. All of them.`;
  if (meanK < 320) return `Average surface: ${c}. Surprisingly reasonable.`;
  if (meanK < 373) return `Average surface: ${c}. Bring shade.`;
  return `Average surface: ${c}. Do not visit.`;
}

// "Only 40 light-years away · 1.1× the size of Earth" — omits what's unmeasured.
export function postcardTravel(dist_ly: number | null, radius: number | null): string {
  const parts: string[] = [];
  if (dist_ly != null) parts.push(`Only ${n(dist_ly)} light-years away`);
  if (radius != null) parts.push(`${n(radius)}× the size of Earth`);
  return parts.join(' · ');
}

export function postcardSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'world';
}

// FNV-1a hash + mulberry32 — a deterministic starfield: same world, same sky.
export function seed32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FONT = 'ui-sans-serif, system-ui, sans-serif';

// Manual rounded-rect path (no ctx.roundRect — keeps older Safari happy).
function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export interface PostcardOpts {
  name: string;
  field: Uint8Array;              // packed uint8, 0 = missing, 1..255 linear over kRange
  grid: [number, number];         // [rows(lat), cols(lon)]
  kRange: [number, number];       // [lo, hi] kelvin
  meanK: number;                  // area-weighted global mean
  dist_ly: number | null;
  radius: number | null;
  blurbLine: string;              // caller-derived subtitle (regime + assumption)
}

export async function downloadPostcard(o: PostcardOpts): Promise<void> {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  if (!c) return;

  // --- cosmic backdrop + deterministic starfield ---
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1020'); bg.addColorStop(1, '#080b16');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const rand = mulberry32(seed32(o.name));
  for (let i = 0; i < 170; i++) {
    const x = rand() * W, y = rand() * H, r = 0.4 + rand() * 1.1;
    c.globalAlpha = 0.2 + rand() * 0.6;
    c.fillStyle = rand() < 0.12 ? '#9cc3ff' : '#e7ebf7';
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;

  // --- retro-poster type block: kicker / title / subtitle ---
  c.textAlign = 'center';
  c.fillStyle = '#6fa8ff'; c.font = `600 24px ${FONT}`;
  c.fillText('V I S I T', W / 2, 66);
  let px = 76;                                            // shrink-to-fit the name
  c.font = `800 ${px}px ${FONT}`;
  const title = o.name.toUpperCase();
  while (px > 30 && c.measureText(title).width > 1080) { px -= 4; c.font = `800 ${px}px ${FONT}`; }
  c.fillStyle = '#e7ebf7';
  c.fillText(title, W / 2, 142);
  c.fillStyle = '#9aa3be'; c.font = `500 19px ${FONT}`;
  c.fillText(o.blurbLine.toUpperCase(), W / 2, 176);

  // --- the modeled climate field, LARGE: native grid → nearest-neighbor upscale,
  //     rounded-rect clipped. Same mapping as SurfaceMap (0 = missing → dark). ---
  const [rows, cols] = o.grid;
  const [lo, hi] = o.kRange;
  const src = document.createElement('canvas');
  src.width = cols; src.height = rows;
  const sctx = src.getContext('2d');
  if (!sctx) return;
  const img = sctx.createImageData(cols, rows);
  for (let i = 0; i < rows * cols; i++) {
    const u = o.field[i];
    let r = 16, g = 20, b = 34;
    if (u !== 0) [r, g, b] = climateRgb(lo + ((u - 1) / 254) * (hi - lo));
    const p = i * 4;
    img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const mx = 60, my = 200, mw = 1080, mh = 540;           // 2:1, matches the 64×32 grid
  c.save();
  rr(c, mx, my, mw, mh, 18); c.clip();
  c.imageSmoothingEnabled = false;                        // honest pixels, no fake detail
  c.drawImage(src, mx, my, mw, mh);
  c.restore();
  rr(c, mx, my, mw, mh, 18);
  c.strokeStyle = 'rgba(231, 235, 247, 0.16)'; c.lineWidth = 2; c.stroke();

  // --- stat + travel lines ---
  c.fillStyle = '#e7ebf7'; c.font = `600 30px ${FONT}`;
  c.fillText(postcardStat(o.meanK), W / 2, 794);
  const travel = postcardTravel(o.dist_ly, o.radius);
  if (travel) { c.fillStyle = '#9aa3be'; c.font = `500 21px ${FONT}`; c.fillText(travel, W / 2, 830); }

  // --- honest footer strip ---
  c.fillStyle = 'rgba(8, 12, 22, 0.85)'; c.fillRect(0, H - 48, W, 48);
  c.strokeStyle = 'rgba(60, 74, 110, 0.35)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, H - 48); c.lineTo(W, H - 48); c.stroke();
  c.fillStyle = '#69728f'; c.font = `16px ${FONT}`;
  c.fillText('Physically modeled climate — not an artist’s concept · thousandworldsexplorer.com', W / 2, H - 18);

  // download (same toBlob pattern as FindingForge's share card)
  await new Promise<void>((resolve) => {
    cv.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `postcard-${postcardSlug(o.name)}.png`; a.click();
        URL.revokeObjectURL(url);
      }
      resolve();
    }, 'image/png');
  });
}
