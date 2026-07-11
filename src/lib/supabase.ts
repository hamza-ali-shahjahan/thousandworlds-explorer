// Supabase client for the explorer's optional accounts layer.
//
// The explorer still runs fully anonymously and locally when no Supabase keys
// are set — `supabase` is then `null` and nothing leaves the user's machine.
// Accounts (save / share / admin) light up only once VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY are provided (see .env.example and docs/accounts-setup.md).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// A creation is one of the three things a user makes in the Imagine Lab.
export type CreationType = 'finding' | 'world' | 'estimate';

export interface Creation {
  id: string;
  user_id: string;
  type: CreationType;
  title: string | null;
  payload: Record<string, unknown>;
  is_public: boolean;
  share_slug: string | null;
  created_at: string;
}

// A random per-tab-session id so the admin dashboard can tell visits apart
// without identifying anyone: no cookie, no fingerprint, gone when the tab closes.
function anonSession(): string {
  let s = sessionStorage.getItem('tw_sid');
  if (!s) { s = crypto.randomUUID(); sessionStorage.setItem('tw_sid', s); }
  return s;
}

// "Do not track me" browser signals — honored for anonymous usage events.
const dnt = () =>
  navigator.doNotTrack === '1' || (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

// Fire-and-forget activity log for the admin dashboard. Signed-in events carry
// the user id; anonymous events (pageviews, errors) insert with user_id null
// and only a random session id — never an IP, user-agent, or identifier.
// Silently no-ops when Supabase isn't configured or the visitor asked not
// to be tracked.
export function logEvent(type: string, meta: Record<string, unknown> = {}): void {
  if (!supabase) return;
  supabase.auth.getSession().then(({ data }) => {
    const uid = data.session?.user.id ?? null;
    if (!uid && dnt()) return;
    // .then() matters: supabase-js builders are lazy thenables — without it
    // the request is never sent at all.
    supabase!.from('events').insert({ user_id: uid, type, meta: { ...meta, sid: anonSession() } })
      .then(null, () => {});
  });
}
