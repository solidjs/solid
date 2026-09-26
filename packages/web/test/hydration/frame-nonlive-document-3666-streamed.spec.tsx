/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3666 follow-up — NON-LIVE server component under Loading, streamed (fallback in the shell, frame streamed).
 * One file per page: the frames client's boundary index is module state
 * (seeded once from document.body), so a second loaded-mode page in the
 * same module would read as "not yet" — see frame-live-document*.spec.tsx.
 */
import { afterEach, describe, test, vi } from "vitest";
import { runNonLive } from "./frame-nonlive-document-3666-run.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as any)._$HY;
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

describe("document face — NON-LIVE server component under Loading (hydrate): streamed (fallback in the shell, frame streamed)", () => {
  test("streamed [loaded]: fragment swapped in before hydrate", () =>
    runNonLive("streamed", "loaded"));
  test("streamed [streamed]: hydrate, then the fragment lands", () =>
    runNonLive("streamed", "streamed"));
});
