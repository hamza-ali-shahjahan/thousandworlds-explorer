// ---------------------------------------------------------------------------
// climate.ts — the site-wide CONTINUOUS climate colormap for surface maps.
//
// The scatter dots stay categorical (five flat regime colors — the local
// tColor helpers in ThousandWorlds.tsx / ImagineLab.tsx): a dot answers
// "which climate is this?". Surface MAPS answer "what's the structure?" —
// and the old five-flat-band palette collapsed any world whose whole surface
// sat inside one band (a 430 K scorching build, a deep snowball) into a
// single featureless rectangle, which read as "the map is broken".
//
// This ramp keeps the same five regime hues as anchors — a red dot still
// opens into a red-hot surface, and the map finally matches the smooth
// legend gradient the hero always showed — but interpolates continuously
// between them, and extends past both ends (deep-frozen navy below, magma
// dark-red above) so even one-regime worlds show their substellar→night
// structure. Each band's identity color sits at the band's centre, so
// mid-band reads exactly like its dot; band edges (240/273/320/373 K) blend.
// ---------------------------------------------------------------------------

export type Rgb = [number, number, number];

const STOPS: [number, Rgb][] = [
  [90, [0x2f, 0x46, 0x9e]],   // deep-frozen navy (the coldest cells the dataset encodes)
  [165, [0x6f, 0xa8, 0xff]],  // snowball blue
  [256, [0x7f, 0xcf, 0xe6]],  // cold cyan
  [296, [0x46, 0xd4, 0x9a]],  // temperate green (liquid-water band)
  [346, [0xf0, 0xb2, 0x4a]],  // hot amber
  [411, [0xe2, 0x4b, 0x4a]],  // scorching red
  [500, [0x83, 0x1f, 0x2b]],  // magma dark-red (runaway tail)
];

export function climateRgb(t: number): Rgb {
  if (!Number.isFinite(t) || t <= STOPS[0][0]) return STOPS[0][1];
  const last = STOPS[STOPS.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    if (t < t1) {
      const [t0, c0] = STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return last[1];
}

/** CSS linear-gradient sampling the ramp across [lo, hi] kelvin — colorbars/legends. */
export function climateCssRamp(lo: number, hi: number, n = 14): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const [r, g, b] = climateRgb(lo + ((hi - lo) * i) / Math.max(1, n - 1));
    parts.push(`rgb(${r},${g},${b})`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
