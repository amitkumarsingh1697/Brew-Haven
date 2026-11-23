/**
 * Error tracking with Sentry, switched on by SENTRY_DSN (free plan is enough for a pilot).
 * Off when unset, so local runs and tests send nothing. No personal data leaves:
 * request bodies, cookies, auth headers and tracking tokens in URLs are removed first.
 */
type Sentry = typeof import("@sentry/node");
let sentry: Sentry | null = null;

const TOKEN_PATHS = /\/(v1\/track|order)\/[^/?#]+/g;
export const scrubUrl = (url: string) => url.replace(TOKEN_PATHS, "/$1/:token").replace(/([?&](token|key)=)[^&#]+/gi, "$1[removed]");

export async function initErrorTracking(env: string, dsn = process.env.SENTRY_DSN) {
  if (!dsn) return false;
  sentry = await import("@sentry/node");
  sentry.init({
    dsn,
    environment: env,
    release: process.env.RENDER_GIT_COMMIT || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        if (event.request.headers) for (const h of ["authorization", "cookie", "x-forwarded-for", "x-real-ip"]) delete event.request.headers[h];
        if (event.request.url) event.request.url = scrubUrl(event.request.url);
      }
      delete event.user;
      return event;
    },
  });
  return true;
}

export function captureError(err: unknown, tags: Record<string, string> = {}) {
  if (!sentry) return;
  sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(tags)) scope.setTag(k, scrubUrl(v));
    sentry!.captureException(err);
  });
}
