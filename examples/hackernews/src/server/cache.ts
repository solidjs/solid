/**
 * Every screen's response is cacheable for a minute: HN's data is public and
 * a minute stale is fine. It is also what makes a hover's call count — the
 * response sits in the browser's HTTP cache when the click makes the same
 * GET (a click while the hover is still in flight is the browser's to share
 * or not). The SPA twin keeps that in memory instead, through `query`.
 */
export const cacheable = { headers: { "cache-control": "public, max-age=60" } };
