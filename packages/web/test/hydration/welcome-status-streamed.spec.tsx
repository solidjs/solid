/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Streamed: hydration runs against the shell mid-generation, fragments
 * land after — the chat welcome's real timeline.
 * One mode per spec file — see welcome-status-parity.tsx for why.
 */
import { afterEach, describe, test } from "vitest";
import { cleanupWelcomeStatusParity, runWelcomeStatusParity } from "./welcome-status-parity.jsx";

describe("welcome/status parity — hydration (streamed)", () => {
  afterEach(cleanupWelcomeStatusParity);
  test("the adopted fill claims the server nodes with no key misses", () =>
    runWelcomeStatusParity("streamed"));
});
