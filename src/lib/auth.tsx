// Auth context for the explorer. Wraps the app and exposes the current user,
// their profile (incl. admin flag), and passwordless magic-link sign in/out.
// When Supabase isn't configured the provider is inert and `user` stays null.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './supabase';
import { AGE_MESSAGES, checkBirthYear, rememberAgeRefusal } from './legal';

// Google sign-in leaves the page, so the age confirmation rides across the
// redirect in sessionStorage and is written to the account when it returns.
const PENDING_AGE_KEY = 'tw_age_confirmed_pending';

// The neutral age question, checked again here so no caller can skip it.
// Under-age: refuse, remember for the session, and never call Supabase.
function ageError(birthYear: string): string | null {
  const verdict = checkBirthYear(birthYear);
  if (verdict === 'ok') return null;
  if (verdict === 'refused') rememberAgeRefusal();
  return AGE_MESSAGES[verdict];
}

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
}

interface AuthState {
  configured: boolean;
  loading: boolean;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  signIn: (email: string, birthYear: string) => Promise<{ error: string | null }>;
  signInWithGoogle: (birthYear: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState<boolean>(supabaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session: Session | null) => {
      setUser(session?.user ?? null);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  // Back from Google: record the age confirmation given before the redirect.
  useEffect(() => {
    if (!supabase || !user) return;
    let year: string | null = null;
    try { year = sessionStorage.getItem(PENDING_AGE_KEY); sessionStorage.removeItem(PENDING_AGE_KEY); } catch { /* storage blocked */ }
    if (year && !user.user_metadata?.age_confirmed) {
      void supabase.auth.updateUser({ data: { age_confirmed: true, birth_year: Number(year) } });
    }
  }, [user]);

  // Load the user's profile (display name + admin flag) whenever they change.
  useEffect(() => {
    if (!supabase || !user) { setProfile(null); return; }
    let active = true;
    supabase
      .from('profiles')
      .select('id, email, display_name, is_admin')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (active) setProfile((data as Profile) ?? null); });
    return () => { active = false; };
  }, [user]);

  const value = useMemo<AuthState>(() => ({
    configured: supabaseConfigured,
    loading,
    user,
    profile,
    isAdmin: Boolean(profile?.is_admin),
    async signIn(email: string, birthYear: string) {
      if (!supabase) return { error: 'Accounts are not configured yet.' };
      const ageErr = ageError(birthYear);
      if (ageErr) return { error: ageErr };
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin,
          // Stored as user metadata on sign-up.
          data: { age_confirmed: true, birth_year: Number(birthYear.trim()) },
        },
      });
      return { error: error ? error.message : null };
    },
    async signInWithGoogle(birthYear: string) {
      if (!supabase) return { error: 'Accounts are not configured yet.' };
      const ageErr = ageError(birthYear);
      if (ageErr) return { error: ageErr };
      try { sessionStorage.setItem(PENDING_AGE_KEY, birthYear.trim()); } catch { /* storage blocked */ }
      // Full-page redirect to Google, then back to the app (origin must be in
      // Supabase's redirect allow-list — same one the magic link uses).
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      return { error: error ? error.message : null };
    },
    async signOut() { await supabase?.auth.signOut(); },
  }), [loading, user, profile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
