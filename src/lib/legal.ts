// Legal settings for the accounts layer, in one place.

// Nobody younger than this can create an account (COPPA).
// Raise to 16 for EU audiences (GDPR Art. 8).
export const MIN_AGE = 13;

// Session flag that keeps a refusal sticky, so the back button cannot retry.
export const AGE_REFUSED_KEY = 'tw_age_refused';

export type BirthYearCheck = 'ok' | 'missing' | 'invalid' | 'refused';

// Judge a typed year of birth. A year alone cannot say whether the birthday
// has passed, so this uses the youngest age the person could be.
export function checkBirthYear(raw: string, now = new Date()): BirthYearCheck {
  const text = raw.trim();
  if (!text) return 'missing';
  if (!/^\d{4}$/.test(text)) return 'invalid';
  const year = Number(text);
  const thisYear = now.getFullYear();
  if (year < 1900 || year > thisYear) return 'invalid';
  return thisYear - year - 1 >= MIN_AGE ? 'ok' : 'refused';
}

// Neutral on purpose: no message names the cut-off.
export const AGE_MESSAGES: Record<Exclude<BirthYearCheck, 'ok'>, string> = {
  missing: 'Enter your year of birth.',
  invalid: 'That does not look like a year of birth.',
  refused: "Sorry — we can't create an account for you.",
};

export function ageRefusedThisSession(): boolean {
  try { return sessionStorage.getItem(AGE_REFUSED_KEY) === '1'; } catch { return false; }
}

export function rememberAgeRefusal(): void {
  try { sessionStorage.setItem(AGE_REFUSED_KEY, '1'); } catch { /* storage blocked */ }
}
