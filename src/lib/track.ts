import { logEvent } from './supabase';

// One call, two sinks: GA4 (the gtag loaded in index.html) for aggregate
// reports, plus the app's own privacy-respecting events table (lib/supabase
// logEvent — honors Do-Not-Track for anonymous visitors, feeds the admin
// dashboard). Event names are snake_case; params stay LOW-CARDINALITY
// (regime buckets, preset labels, view names — world names are the one
// deliberate exception, so "which worlds fascinate people" is answerable).
declare global { interface Window { gtag?: (...args: unknown[]) => void } }
type Params = Record<string, string | number | boolean>;

export function track(name: string, params: Params = {}): void {
  try { window.gtag?.('event', name, params); } catch { /* blocked/absent — fine */ }
  logEvent(name, params);
}

// Virtual page_view for SPA tab changes — without this, GA4's "Pages and
// screens" only ever shows "/" because the auto page_view fires once at load.
export function trackScreen(path: string, title: string): void {
  try {
    window.gtag?.('event', 'page_view', {
      page_path: path,
      page_title: title,
      page_location: window.location.origin + path,
    });
  } catch { /* blocked/absent — fine */ }
  logEvent('screen_view', { path });
}
