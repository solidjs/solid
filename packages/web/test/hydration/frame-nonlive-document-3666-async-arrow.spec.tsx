/**
 * @jsxImportSource @solidjs/web
 *
 * #3666 — a NON-LIVE server component via dynamic() under a settled
 * <Loading>, where the client source is a user's `async` arrow
 * (`async () => await getNote(id)`): a real promise around the intercept's
 * synchronous answer. Adoption of the instance's record makes the arrow
 * irrelevant to hydration. One page per file: the frames client's boundary
 * index is module state.
 */
import { test } from "vitest";
import { runNonLive } from "./frame-nonlive-document-3666-run.jsx";

test("non-live server component via dynamic(), async arrow source — inline [loaded]", async () => {
  await runNonLive("inline", "loaded", "async");
});
