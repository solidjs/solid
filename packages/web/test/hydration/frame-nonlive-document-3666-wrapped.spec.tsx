/**
 * @jsxImportSource @solidjs/web
 *
 * #3666 — a NON-LIVE server component via dynamic() under a settled
 * <Loading>, where the client source hands the intercept's synchronous
 * answer back inside a promise: `Promise.resolve(hit)` is what
 * @solidjs/router's `query()` does around every read (its response handler
 * is an `async` function), the idiomatic `dynamic(() => getNote(id))` with
 * `getNote = query(noteView, "note")`. The instance memo adopts the
 * server's record, so the wrapper never puts the boundary through a pending
 * beat. One page per file: the frames client's boundary index is module
 * state.
 */
import { test } from "vitest";
import { runNonLive } from "./frame-nonlive-document-3666-run.jsx";

test("non-live server component via dynamic(), source wrapped in Promise.resolve (the query() shape) — inline [loaded]", async () => {
  await runNonLive("inline", "loaded", "resolve");
});
