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

// Fire-and-forget activity log (runs / saves / shares) for the admin dashboard.
// Silently no-ops when signed out or when Supabase isn't configured.
export function logEvent(type: string, meta: Record<string, unknown> = {}): void {
  if (!supabase) return;
  supabase.auth.getUser().then(({ data }) => {
    if (!data.user) return;
    void supabase!.from('events').insert({ user_id: data.user.id, type, meta });
  });
}
