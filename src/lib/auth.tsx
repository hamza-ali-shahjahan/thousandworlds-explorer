// Auth context for the explorer. Wraps the app and exposes the current user,
// their profile (incl. admin flag), and passwordless magic-link sign in/out.
// When Supabase isn't configured the provider is inert and `user` stays null.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './supabase';

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
  signIn: (email: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
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
    async signIn(email: string) {
      if (!supabase) return { error: 'Accounts are not configured yet.' };
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      return { error: error ? error.message : null };
    },
    async signInWithGoogle() {
      if (!supabase) return { error: 'Accounts are not configured yet.' };
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
