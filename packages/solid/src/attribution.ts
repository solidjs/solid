/**
 * `solid-js/attribution` — the "why did this run" engine, re-exported from
 * `@solidjs/signals/attribution` so apps never import signals directly.
 *
 * One build for every tier and environment: this file has no wiring of its
 * own, and which engine it resolves to (the real one in dev/observe, the inert
 * twin in prod) is decided where `@solidjs/signals/attribution` is resolved —
 * by the same export conditions that pick the `solid-js` runtime, so the two
 * always agree.
 */
export * from "@solidjs/signals/attribution";
