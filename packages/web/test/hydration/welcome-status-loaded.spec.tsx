/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Loaded: the full document (shell + streamed fragments) is on the page
 * before hydration starts — the finished-welcome reload case.
 * One mode per spec file — see welcome-status-parity.tsx for why.
 */
import { afterEach, describe, test } from "vitest";
import { cleanupWelcomeStatusParity, runWelcomeStatusParity } from "./welcome-status-parity.jsx";

describe("welcome/status parity — hydration (loaded)", () => {
  afterEach(cleanupWelcomeStatusParity);
  test("the adopted fill claims the server nodes with no key misses", () =>
    runWelcomeStatusParity("loaded"));
});
