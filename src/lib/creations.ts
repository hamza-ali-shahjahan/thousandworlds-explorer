// Save / share / list a user's Imagine-Lab creations. Backend-agnostic helpers
// over Supabase; every function no-ops safely when signed out or unconfigured.
// Row-Level Security (see supabase/schema.sql) is the real guard — these just
// shape the queries.
import { supabase, logEvent, type Creation, type CreationType } from './supabase';

// Short, URL-friendly share id (crypto-random, ~9 chars).
function makeSlug(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 9);
}

async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export interface SaveInput {
  type: CreationType;
  title: string;
  payload: Record<string, unknown>;
  isPublic?: boolean;
}

export async function saveCreation(input: SaveInput): Promise<{ data: Creation | null; error: string | null }> {
  const id = await uid();
  if (!supabase || !id) return { data: null, error: 'Sign in to save your worlds.' };
  const row = {
    user_id: id,
    type: input.type,
    title: input.title,
    payload: input.payload,
    is_public: input.isPublic ?? false,
    share_slug: input.isPublic ? makeSlug() : null,
  };
  const { data, error } = await supabase.from('creations').insert(row).select().single();
  if (!error) logEvent('save', { type: input.type, public: row.is_public });
  return { data: (data as Creation) ?? null, error: error?.message ?? null };
}

// The signed-in user's own saved creations (newest first) — for the "My Lab" panel.
export async function listMyCreations(): Promise<Creation[]> {
  const id = await uid();
  if (!supabase || !id) return [];
  const { data } = await supabase
    .from('creations').select('*')
    .eq('user_id', id)
    .order('created_at', { ascending: false });
  return (data as Creation[]) ?? [];
}

// Public creations for the community gallery (anyone can read these, signed in or not).
export async function listPublicCreations(limit = 60): Promise<Creation[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('creations').select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data as Creation[]) ?? [];
}

// One public creation by its share slug — for the read-only /#share=<slug> page.
export async function getCreationBySlug(slug: string): Promise<Creation | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('creations').select('*').eq('share_slug', slug).maybeSingle();
  return (data as Creation) ?? null;
}

// Flip a creation public/private; mints a share slug the first time it goes public.
export async function setCreationPublic(id: string, isPublic: boolean): Promise<{ slug: string | null; error: string | null }> {
  if (!supabase) return { slug: null, error: 'Accounts not configured.' };
  const patch: Record<string, unknown> = { is_public: isPublic, updated_at: new Date().toISOString() };
  if (isPublic) patch.share_slug = makeSlug();
  const { data, error } = await supabase.from('creations').update(patch).eq('id', id).select('share_slug').single();
  if (!error && isPublic) logEvent('share', { id });
  return { slug: (data as { share_slug: string } | null)?.share_slug ?? null, error: error?.message ?? null };
}

export async function deleteCreation(id: string): Promise<string | null> {
  if (!supabase) return 'Accounts not configured.';
  const { error } = await supabase.from('creations').delete().eq('id', id);
  return error?.message ?? null;
}

// Build a shareable URL for a public creation.
export function shareUrl(slug: string): string {
  return `${window.location.origin}/#share=${slug}`;
}
