// World of the Day — resolves a UTC date to the world scheduled for it in the
// build-time /wotd.json (21-day window emitted by scripts/build-data.mjs).
interface WotdDay { name: string; blurb: string; }
interface WotdFile { generated: string; days: Record<string, WotdDay>; }

let cached: Promise<WotdFile | null> | null = null; // module-cached: one fetch per page load
const load = (): Promise<WotdFile | null> =>
  (cached ??= fetch('/wotd.json')
    .then((r) => (r.ok ? (r.json() as Promise<WotdFile>) : null))
    .catch(() => null));

// date defaults to today (UTC); unknown / out-of-window dates resolve to null.
export async function worldOfTheDay(date?: string): Promise<{ name: string; blurb: string; date: string } | null> {
  const d = date ?? new Date().toISOString().slice(0, 10);
  const day = (await load())?.days?.[d];
  return day ? { name: day.name, blurb: day.blurb, date: d } : null;
}
