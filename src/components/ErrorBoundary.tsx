import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logEvent } from '../lib/supabase';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

// Catches any render error so a bad state (e.g. a malformed shared/deep-link URL)
// shows a friendly recovery screen instead of a blank white page.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logEvent('client_error', {
      message: String(error?.message ?? error).slice(0, 300),
      stack: error?.stack?.slice(0, 600) ?? null,
      component: info.componentStack?.slice(0, 300) ?? null,
      url: window.location.href.slice(0, 300),
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="errboundary">
          <div className="errcard">
            <h1>Something went off-orbit</h1>
            <p>This view couldn't be drawn — most often that means a shared link got garbled. Your data is fine; let's get you back to the worlds.</p>
            <div className="errbtns">
              <button className="btn primary" onClick={() => { window.location.href = window.location.pathname; }}>Back to all worlds</button>
              <button className="btn" onClick={() => window.location.reload()}>Reload</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
