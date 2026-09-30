/**
 * @vitest-environment jsdom
 *
 * The public hydration-state API (`isHydrating`, `isHydratable`) on the
 * client entry.
 */
import { describe, expect, test, afterEach } from "vitest";
import { createRoot, flush, onSettled, untrack, createMemo as coreMemo } from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig,
  createMemo,
  createSignal,
  createRenderEffect,
  NoHydration,
  Hydration,
  isHydrating,
  isHydratable
} from "../src/client/hydration.js";
import { Loading } from "../src/client/flow.js";

enableHydration();

function startHydration(data: Record<string, any>) {
  (globalThis as any)._$HY = {
    modules: {},
    loading: {},
    r: data,
    events: [],
    completed: new WeakSet()
  };
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = (id: string) => id in data;
  (sharedConfig as any).load = (id: string) => data[id];
  (sharedConfig as any).gather = () => {};
  (sharedConfig as any).registry = new Map();
}

function stopHydration() {
  sharedConfig.hydrating = false;
  (sharedConfig as any).has = undefined;
  (sharedConfig as any).load = undefined;
  (sharedConfig as any).gather = undefined;
  delete (globalThis as any)._$HY;
}

describe("isHydrating", () => {
  afterEach(() => stopHydration());

  test("false outside hydration (client-only render)", () => {
    let seen: boolean | undefined;
    createRoot(() => {
      seen = isHydrating();
    });
    expect(seen).toBe(false);
  });

  test("true in the root pass, false after it; per-boundary during a streamed resume", async () => {
    let resolveFr!: (v: boolean) => void;
    const fr: any = new Promise<boolean>(r => (resolveFr = r));
    fr.s = 0;
    startHydration({ t0_fr: fr, t0000: { s: 1, v: 1 } });

    const seen: Record<string, [api: boolean, raw: boolean][]> = {};
    const record = (k: string) => (seen[k] ||= []).push([isHydrating(), sharedConfig.hydrating]);
    let reveal!: (v: boolean) => void;

    createRoot(
      () => {
        const [shown, setShown] = createSignal(false, { ownedWrite: true });
        reveal = setShown;
        Loading({
          fallback: "loading",
          get children() {
            record("inside-boundary");
            const m = createMemo(() => 0);
            // The resumed content's user tier writes above the boundary (#3504).
            onSettled(() => {
              setShown(true);
            });
            return (() => m()) as any;
          }
        });
        // Outside the boundary: a control-flow-shaped memo whose truthy branch
        // creates (records) under its own owner.
        const branch = coreMemo(() => (shown() ? untrack(() => (record("outside-branch"), 1)) : 0));
        createRenderEffect(
          () => branch(),
          () => {}
        );
        record("root-pass");
      },
      { id: "t" }
    );
    flush();
    // hydrate()'s `finally`: the root pass is over, the boundary still pending.
    sharedConfig.hydrating = false;
    record("between-windows");

    resolveFr(true);
    await new Promise(r => setTimeout(r, 20));
    flush();
    await new Promise(r => setTimeout(r, 0));
    flush();

    expect(seen["root-pass"]).toEqual([[true, true]]);
    expect(seen["between-windows"]).toEqual([[false, false]]);
    // The resumed boundary's content: claiming.
    expect(seen["inside-boundary"]?.at(-1)?.[0]).toBe(true);
    // The render forced outside the resuming boundary is a client render.
    // The raw flag libraries read today says `true` there; the API does not.
    expect(seen["outside-branch"]).toEqual([[false, true]]);
    void reveal;
  });
});

describe("isHydratable (client)", () => {
  test("positional: true under a root, false under <NoHydration> (a nested <Hydration> is a client passthrough), false with no owner", () => {
    const seen: Record<string, boolean> = {};
    seen.noOwner = isHydratable();
    createRoot(() => {
      seen.root = isHydratable();
      NoHydration({
        get children() {
          seen.noHydration = isHydratable();
          Hydration({
            get children() {
              seen.island = isHydratable();
              return undefined as any;
            }
          });
          return undefined as any;
        }
      });
    });
    expect(seen).toEqual({ noOwner: false, root: true, noHydration: false, island: false });
  });
});
