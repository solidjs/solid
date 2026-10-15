/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Lazy: the loaded document, hydrated with the traces tier NOT resident —
 * the production wiring end to end: the shell's data script announces the
 * tier (`_$HY.r["sc:tiers"] = ["trace"]`), `installServerComponents` starts
 * the import from the record, the adopted boundary holds the `status#0`
 * occurrence (its server-rendered interior stays on screen, the hold a
 * pending boundary under frames-rulings 3.1) until the load settles, then
 * mounts the fill, which claims the same server nodes in place: a late
 * attach, never a re-render, and no key misses. One configuration per spec
 * file — see welcome-status-parity.tsx for why (and a tier, once resident,
 * stays so for the worker — the resident specs would pre-empt the hold).
 */
import { afterEach, describe, test } from "vitest";
import { cleanupWelcomeStatusParity, runWelcomeStatusParity } from "./welcome-status-parity.jsx";

describe("welcome/status parity — hydration (loaded, the traces tier loads lazily)", () => {
  afterEach(cleanupWelcomeStatusParity);
  test("the adopted fill is held until the tier loads, then claims the server nodes with no key misses", () =>
    runWelcomeStatusParity("loaded", { lazy: true }));
});
