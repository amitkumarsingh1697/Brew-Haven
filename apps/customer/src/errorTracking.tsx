/**
 * Error tracking with Sentry, switched on by VITE_SENTRY_DSN at build time; off when unset.
 * The SDK loads only when switched on. No personal data: no user, no IP, and order
 * tracking tokens are removed from URLs before anything is sent.
 */
import { Component, type ReactNode } from "react";

type Sentry = typeof import("@sentry/react");
let sentry: Sentry | null = null;

const scrub = (url?: string) => url?.replace(/\/(v1\/track|order)\/[^/?#]+/g, "/$1/:token").replace(/([?&](token|key|pay)=)[^&#]+/gi, "$1[removed]");

export async function initErrorTracking() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  try {
    sentry = await import("@sentry/react");
    sentry.init({
      dsn,
      environment: (import.meta.env.VITE_APP_ENV as string | undefined) ?? import.meta.env.MODE,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend(event) {
        delete event.user;
        if (event.request) {
          event.request.url = scrub(event.request.url);
          delete event.request.headers;
          delete event.request.cookies;
        }
        return event;
      },
      beforeBreadcrumb(b) {
        if (b.data) for (const k of ["url", "from", "to"]) if (typeof b.data[k] === "string") b.data[k] = scrub(b.data[k]);
        return b;
      },
    });
  } catch {
    sentry = null; // blocked by the browser or an extension: carry on without it
  }
}

export function captureError(err: unknown) {
  sentry?.captureException(err);
}

/** Catches a crash in any screen, reports it, and offers a reload instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    captureError(err);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page" role="alert" style={{ padding: 24, textAlign: "center" }}>
        <h1>Something went wrong</h1>
        <p>Sorry, this screen hit a problem. Reloading usually fixes it.</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
