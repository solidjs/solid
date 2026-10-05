/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Lazy: the loaded document, hydrated with the container-trace materializer
 * NOT resident — the production host's wiring, where the frames client
 * fetches `solid-js/internal/container-trace` behind the first record that
 * carries a trace. The adopted boundary holds the `status#0` occurrence
 * (its server-rendered interior stays on screen) until the load settles,
 * then mounts the fill, which claims the same server nodes in place: a late
 * attach, never a re-render, and no key misses. One configuration per spec
 * file — see welcome-status-parity.tsx for why (and the materializer's
 * install is process-global state, so the resident specs would pre-empt it).
 */
import { afterEach, describe, test } from "vitest";
import { cleanupWelcomeStatusParity, runWelcomeStatusParity } from "./welcome-status-parity.jsx";

describe("welcome/status parity — hydration (loaded, materializer loads lazily)", () => {
  afterEach(cleanupWelcomeStatusParity);
  test("the adopted fill is held until the materializer loads, then claims the server nodes with no key misses", () =>
    runWelcomeStatusParity("loaded", { lazy: true }));
});
