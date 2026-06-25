import type { ReactNode } from 'react';

// Plain-language, one-sentence definitions surfaced as just-in-time tooltips
// so a beginner who skipped the tour never hits an unexplained term.
export const GLOSSARY: Record<string, string> = {
  distance: 'How far the world is from Earth, in light-years — the distance light travels in one year (about 9.5 trillion km).',
  size: 'The planet’s radius compared to Earth’s. 1 = Earth-sized; about 4 ≈ Neptune; about 11 ≈ Jupiter.',
  temperature: 'Equilibrium temperature: how warm starlight alone would make the planet, before any atmosphere is taken into account.',
  year: 'How long the planet takes to circle its star once — its “year”. Many known worlds orbit in just days.',
  mass: 'How much matter the planet has, compared to Earth.',
  orbit: 'The average distance from the planet to its star, in AU. One AU is the Earth–Sun distance (~150 million km).',
  eccentricity: 'How stretched the orbit is: 0 is a perfect circle; closer to 1 is a long, narrow ellipse.',
  esi: 'A rough Earth-likeness score built from size and temperature only — a simple heuristic, not a claim about water, air, or life.',
};

export default function Term({ name, children }: { name: string; children: ReactNode }) {
  const def = GLOSSARY[name];
  if (!def) return <>{children}</>;
  return (
    <span className="term" tabIndex={0}>
      {children}
      <span className="termpop" role="tooltip">{def}</span>
    </span>
  );
}
