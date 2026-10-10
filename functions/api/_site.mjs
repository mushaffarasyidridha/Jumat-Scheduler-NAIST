// The one address that links inside calendar events and emails point to. The same
// whichever address a request arrived on (a preview deployment, a custom domain
// later): otherwise an event's text would change depending on who edited it, and
// the reminder job and the website would keep rewriting each other's version.
export const DEFAULT_SITE_URL = "https://jumat-scheduler-naist.pages.dev";

// `env` is the Pages environment or the job's process.env. Set SITE_URL in both
// if the site ever moves to its own domain.
export function siteUrlFrom(env) {
  return String(env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
}
