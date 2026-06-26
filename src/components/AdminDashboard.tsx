// Admin-only dashboard: who signed up, what they've created, and recent activity.
// Mounts itself as a full-screen overlay when the URL hash is #admin and the
// signed-in user is an admin. Reads across all users (allowed by the admin
// Row-Level-Security policies in supabase/schema.sql).
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

interface ProfileRow { id: string; email: string | null; display_name: string | null; is_admin: boolean; created_at: string; }
interface CreationRow { id: string; user_id: string; type: string; title: string | null; is_public: boolean; created_at: string; }
interface EventRow { user_id: string | null; type: string; created_at: string; }

function useHashActive(hash: string): boolean {
  const [active, setActive] = useState(() => window.location.hash === hash);
  useEffect(() => {
    const on = () => setActive(window.location.hash === hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [hash]);
  return active;
}

const fmtDate = (s: string) => new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const ago = (s: string) => {
  const d = (Date.now() - new Date(s).getTime()) / 1000;
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};

export default function AdminDashboard() {
  const { isAdmin } = useAuth();
  const active = useHashActive('#admin');
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [creations, setCreations] = useState<CreationRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  useEffect(() => {
    if (!active || !isAdmin || !supabase) return;
    let on = true;
    setLoading(true);
    Promise.all([
      supabase.from('profiles').select('id, email, display_name, is_admin, created_at'),
      supabase.from('creations').select('id, user_id, type, title, is_public, created_at').order('created_at', { ascending: false }),
      supabase.from('events').select('user_id, type, created_at').order('created_at', { ascending: false }).limit(200),
    ]).then(([p, c, e]) => {
      if (!on) return;
      setProfiles((p.data as ProfileRow[]) ?? []);
      setCreations((c.data as CreationRow[]) ?? []);
      setEvents((e.data as EventRow[]) ?? []);
      setLoading(false);
    });
    return () => { on = false; };
  }, [active, isAdmin]);

  const emailById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p.email ?? '—'])), [profiles]);
  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400_000;
    const lastActive: Record<string, string> = {};
    for (const ev of events) if (ev.user_id && !lastActive[ev.user_id]) lastActive[ev.user_id] = ev.created_at;
    const countByUser: Record<string, number> = {};
    for (const c of creations) countByUser[c.user_id] = (countByUser[c.user_id] ?? 0) + 1;
    return {
      users: profiles.length,
      newUsers: profiles.filter((p) => new Date(p.created_at).getTime() > weekAgo).length,
      creations: creations.length,
      publicCreations: creations.filter((c) => c.is_public).length,
      runs: events.filter((e) => e.type === 'run').length,
      lastActive, countByUser,
    };
  }, [profiles, creations, events]);

  if (!active) return null;
  const close = () => { window.location.hash = ''; };

  if (!isAdmin) {
    return (
      <div className="admin-overlay">
        <div className="admin-empty">Admins only. <button className="auth-item" onClick={close}>Close</button></div>
      </div>
    );
  }

  return (
    <div className="admin-overlay">
      <header className="admin-top">
        <h2 className="admin-title">Admin · ThousandWorlds Explorer</h2>
        <button className="admin-close" onClick={close} aria-label="Close">×</button>
      </header>

      {loading ? <div className="admin-empty">Loading…</div> : (
        <div className="admin-body">
          <div className="admin-kpis">
            {[
              ['Users', stats.users], ['New this week', stats.newUsers],
              ['Creations', stats.creations], ['Public', stats.publicCreations], ['Runs', stats.runs],
            ].map(([label, n]) => (
              <div className="admin-kpi" key={label as string}>
                <div className="admin-kpi-n">{n as number}</div>
                <div className="admin-kpi-l">{label as string}</div>
              </div>
            ))}
          </div>

          <div className="admin-grid">
            <section className="admin-card">
              <h3 className="admin-h">Users</h3>
              <div className="admin-scroll">
                <table className="admin-tbl">
                  <thead><tr><th>Email</th><th>Joined</th><th>Creations</th><th>Last active</th></tr></thead>
                  <tbody>
                    {profiles.map((p) => (
                      <tr key={p.id}>
                        <td>{p.email}{p.is_admin && <span className="admin-badge">admin</span>}</td>
                        <td>{fmtDate(p.created_at)}</td>
                        <td>{stats.countByUser[p.id] ?? 0}</td>
                        <td>{stats.lastActive[p.id] ? ago(stats.lastActive[p.id]) : '—'}</td>
                      </tr>
                    ))}
                    {!profiles.length && <tr><td colSpan={4} className="admin-muted">No users yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-card">
              <h3 className="admin-h">Latest creations</h3>
              <div className="admin-scroll">
                <table className="admin-tbl">
                  <thead><tr><th>Type</th><th>Title</th><th>By</th><th>When</th><th>Public</th></tr></thead>
                  <tbody>
                    {creations.slice(0, 60).map((c) => (
                      <tr key={c.id}>
                        <td>{c.type}</td>
                        <td>{c.title || '—'}</td>
                        <td>{emailById[c.user_id] ?? '—'}</td>
                        <td>{fmtDate(c.created_at)}</td>
                        <td>{c.is_public ? '🌍' : '—'}</td>
                      </tr>
                    ))}
                    {!creations.length && <tr><td colSpan={5} className="admin-muted">No creations yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-card admin-wide">
              <h3 className="admin-h">Recent activity</h3>
              <div className="admin-scroll admin-feed">
                {events.slice(0, 80).map((e, i) => (
                  <div className="admin-ev" key={i}>
                    <span className="admin-ev-t">{e.type}</span>
                    <span className="admin-muted">{e.user_id ? emailById[e.user_id] ?? '—' : 'anon'}</span>
                    <span className="admin-muted">{ago(e.created_at)}</span>
                  </div>
                ))}
                {!events.length && <div className="admin-muted">No activity yet.</div>}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
