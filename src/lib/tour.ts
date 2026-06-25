import type { World } from '../types';

export interface TourStop {
  name?: string;                         // preferred world (exact dataset name)
  pick?: (ws: World[]) => World | undefined; // fallback if the name is ever missing
  title: string;
  text: string;
}

const nearest = (ws: World[]) => ws.filter((w) => w.dist_ly != null).sort((a, b) => a.dist_ly! - b.dist_ly!)[0];
const hottestGiant = (ws: World[]) => ws.filter((w) => w.teq != null && w.radius != null && w.radius > 4).sort((a, b) => b.teq! - a.teq!)[0];
const mostEarthlike = (ws: World[]) => ws.filter((w) => w.esi != null).sort((a, b) => b.esi! - a.esi!)[0];

// A short, narrated path that carries a passive beginner through landmark worlds.
// Each narration line doubles as a just-in-time explanation of one real concept.
export const TOUR: TourStop[] = [
  {
    name: 'Proxima Cen b', pick: nearest,
    title: 'The closest world to home',
    text: 'Meet Proxima Cen b — the nearest known planet beyond our Solar System, just over 4 light-years away, circling the red-dwarf star next door. It is roughly Earth-sized and temperate. But "nearby" is relative: even at the speed of our fastest spacecraft, the trip would take tens of thousands of years.',
  },
  {
    name: '51 Peg b',
    title: 'The planet that started it all',
    text: '51 Pegasi b was the first planet ever found orbiting a Sun-like star, back in 1995. It is a "hot Jupiter" — a gas giant whipping around its star every four days, roasting above 1,000 °C. Its discovery proved other solar systems can look nothing like our own.',
  },
  {
    name: 'TRAPPIST-1 e',
    title: 'Seven worlds around one tiny star',
    text: 'TRAPPIST-1 e is one of SEVEN Earth-sized planets packed around a cool, dim red dwarf 40 light-years away — the richest known family of rocky worlds. Several orbit in the temperate zone, the band around a star where liquid water could, in principle, survive.',
  },
  {
    name: 'WASP-12 b', pick: hottestGiant,
    title: 'A world being devoured',
    text: 'WASP-12 b is among the hottest planets known — so close to its star that it is stretched into an egg shape and slowly consumed, trailing a comet-like tail of its own atmosphere. The temperature shown is its "equilibrium temperature": how hot starlight alone would make it.',
  },
  {
    name: '55 Cnc e',
    title: 'A possible lava world',
    text: '55 Cancri e is a "super-Earth" hugging its star so tightly that a year there lasts under a day, and its surface may be an ocean of molten rock. Worlds like this show how alien "Earth-sized" can really be — size alone tells you very little.',
  },
  {
    pick: mostEarthlike,
    title: 'The most Earth-like we have found',
    text: 'By a rough score of size and warmth, this ranks among the most Earth-like worlds known. But here "Earth-like" means only similar in size and temperature — we do not yet know if any of these have air, water, or life. That unknown is exactly the frontier. From here, wander on your own: open Charts to see the patterns, or the Table to dig into the numbers.',
  },
];

export function resolveStop(i: number, worlds: World[]): { world: World; title: string; text: string } | null {
  const s = TOUR[i];
  if (!s) return null;
  let w = s.name ? worlds.find((x) => x.name === s.name) : undefined;
  if (!w && s.pick) w = s.pick(worlds);
  return w ? { world: w, title: s.title, text: s.text } : null;
}

export function randomWorld(worlds: World[]): World {
  const pool = worlds.filter((w) => w.radius != null && w.teq != null && w.dist_ly != null);
  return pool[Math.floor(Math.random() * pool.length)] ?? worlds[0];
}
