/**
 * #3648 — an async memo whose FIRST result lands while the node is a member of
 * an optimistic lane.
 *
 * The landing takes `asyncWrite`'s lane branch (async.ts: `else if (lane)`):
 * the value goes into the derived-override slot (`laneOverride`, A17 lanes
 * stage), `_value` stays the never-committed frame and STATUS_UNINITIALIZED
 * stays set until the lane's transaction commits and promotes the override
 * (`resolveOptimisticNodes`). Three consequences at head, all pinned here:
 *
 *   1. `settlePendingSource` fired SETTLE_WALK_UNINITIALIZED_SOURCE (a
 *      severity "error" diagnostic the site neither threw nor reported, so
 *      the console showed the footer alone — brenelz's "[SETTLE_WALK_
 *      UNINITIALIZED_SOURCE] undefined" line). A displayed derived override IS
 *      the node's truth for the walk; the invariant no longer counts it as a
 *      settle without truth (and prints its message when it does fire —
 *      `settle-walk-invariant.test.ts`).
 *   2. An off-lane reader with a stale frame of the node was served
 *      `el._value` (`overrideRead` → `readsHeldCommitted`) — a fabricated
 *      `undefined` for a node that has never committed. Uninitialized is
 *      loading (A19 exception 1, #3276): the reader suspends while the lane
 *      is held and re-derives at the release, ending on the value.
 *   3. The memo's flight was duplicated: its `untrack(() => isPending(loc))`
 *      probe enrolled the memo as a suppressed probe (verdict.ts collectPending
 *      gated on `_fn`, not on `tracking`), and `wakeSuppressedProbes` re-ran
 *      it on the companion's lane. Only a TRACKED probe enrolls its host.
 *
 * Shape A is router-free but structurally the router's: a plain signal write
 * (the location) is held by a lazy module flight; a claims/scroll effect
 * probes `isPending(location)`; the `query()` memo created when the lazy
 * module lands probes `isPending(location)` under `untrack` (router's
 * `getIntent`).
 *
 * Shape B has no probe at all: a memo mounted under a live action lane is
 * re-run by a second optimistic write before its first landing. Same branch,
 * same diagnostic — the engine-level condition is reachable without the
 * probe channel, so the fix cannot live in `isPending` alone. Its failure twin
 * (the action throws while the node is uninitialized under its override) pins
 * that the node re-derives from the superseded source and holds until the
 * re-derivation lands: nobody sees `undefined`, and the reader ends on the
 * truth's answer.
 *
 * Under the ruled design the node may legitimately keep STATUS_UNINITIALIZED
 * while the override is displayed and the lane is held — the assertions here
 * are behavioural, not flag-peeking.
 */
import { describe, expect, it, vi } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  untrack,
  OBSERVE
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flush();
}

describe("#3648 first landing of an async memo under an optimistic lane", () => {
  it("shape A (router-like): query memo created while the navigation write is held, probing isPending(location) untracked", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const capture = OBSERVE!.diagnostics.capture();

    const chunk = deferred<string>(); // lazy route module
    const query = deferred<string>(); // query() flight of the landing route
    const other = deferred<string>(); // a second query on the same route, still in flight
    let queryFlights = 0;

    const [loc, setLoc] = createSignal("/");
    const [flag, setFlag] = createSignal(false);
    const rendered: any[] = [];
    const lateReads: any[] = [];
    let thing!: () => any;

    const dispose = createRoot(dispose => {
      // router claims / scroll-restoration effect: `isRouting()`
      createRenderEffect(
        () => isPending(loc),
        () => {}
      );
      // route matching → lazy module: the location write is held by this flight
      const matches = createMemo(() => {
        const l = loc();
        return l === "/lazy" ? chunk.promise.then(() => l) : l;
      });
      // outlet: the lazy component mounts when its module lands and creates its queries
      createRenderEffect(
        () => {
          const m = matches();
          if (m === "/lazy") {
            thing = createMemo(() => {
              untrack(() => isPending(loc)); // router query(): `untrack(getIntent)`
              queryFlights++;
              return query.promise.then(v => v);
            });
            const otherMemo = createMemo(() => {
              untrack(() => isPending(loc));
              return other.promise.then(v => v);
            });
            createRenderEffect(
              () => thing(),
              v => {
                rendered.push(v);
              }
            );
            createRenderEffect(
              () => otherMemo(),
              () => {}
            );
          }
          return m;
        },
        () => {}
      );
      // an off-lane reader that first reads `thing` after its first landing
      createRenderEffect(
        () => (flag() ? thing() : "off"),
        v => {
          lateReads.push(v);
        }
      );
      return dispose;
    });
    flush();

    setLoc("/lazy");
    flush();
    await settle();
    chunk.resolve("chunk");
    await settle();
    query.resolve("thing a");
    await settle();

    // `other` is still in flight → the lane is still held. `thing` has landed
    // as a derived override. A mainline write re-runs the off-lane reader
    // into it: it has no committed frame to show, so it suspends (2) —
    // publishing neither `undefined` nor the lane's override — and re-derives
    // at the release.
    setFlag(true);
    flush();
    await settle();
    expect(lateReads).toEqual(["off"]);

    other.resolve("other");
    await settle();

    const events = capture.stop();
    const codes = events.map(e => e.code);
    error.mockRestore();
    dispose();

    // the lane's own reader renders the landing (A17)
    expect(rendered).toEqual(["thing a"]);
    // (1) no error-severity diagnostic for a legitimate first landing
    expect(codes).not.toContain("SETTLE_WALK_UNINITIALIZED_SOURCE");
    expect(error).not.toHaveBeenCalled();
    // (2) an outsider never sees a fabricated `undefined` for a node that has
    // never committed, and ends on the value once the lane commits
    expect(lateReads).not.toContain(undefined);
    expect(lateReads).toEqual(["off", "thing a"]);
    // (3) a single flight for the query: the untracked probe enrolled nothing
    expect(queryFlights).toBe(1);
  });

  it("shape A under a boundary: a fresh Loading boundary mounted off the held lane over the never-committed node shows its fallback, then reveals", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const capture = OBSERVE!.diagnostics.capture();

    const chunk = deferred<string>();
    const query = deferred<string>();
    const other = deferred<string>();
    const [loc, setLoc] = createSignal("/");
    const [flag, setFlag] = createSignal(false);
    const views: any[] = [];
    let thing!: () => any;
    let contentRuns = 0;

    const dispose = createRoot(dispose => {
      createRenderEffect(
        () => isPending(loc),
        () => {}
      );
      const matches = createMemo(() => {
        const l = loc();
        return l === "/lazy" ? chunk.promise.then(() => l) : l;
      });
      createRenderEffect(
        () => {
          const m = matches();
          if (m === "/lazy") {
            thing = createMemo(() => {
              untrack(() => isPending(loc));
              return query.promise.then(v => v);
            });
            const otherMemo = createMemo(() => {
              untrack(() => isPending(loc));
              return other.promise.then(v => v);
            });
            createRenderEffect(
              () => thing(),
              () => {}
            );
            createRenderEffect(
              () => otherMemo(),
              () => {}
            );
          }
          return m;
        },
        () => {}
      );
      // a mainline mount, while the lane is held, of a Loading boundary whose
      // content reads the never-committed `thing`
      createRenderEffect(
        () => {
          if (!flag()) return;
          const view = untrack(() =>
            createLoadingBoundary(
              () => {
                contentRuns++;
                return thing();
              },
              () => "fallback"
            )
          );
          createRenderEffect(
            () => view(),
            v => {
              views.push(v);
            }
          );
        },
        () => {}
      );
      return dispose;
    });
    flush();

    setLoc("/lazy");
    flush();
    await settle();
    chunk.resolve("chunk");
    await settle();
    query.resolve("thing a");
    await settle();

    setFlag(true);
    flush();
    await settle();
    // the content suspended on the never-committed node: the boundary shows
    // its fallback and waits — it does not release-and-recollect every flush
    expect(views).toEqual(["fallback"]);
    const runsMidHold = contentRuns;
    await settle();
    await settle();
    expect(contentRuns).toBe(runsMidHold);
    expect(views).toEqual(["fallback"]);

    other.resolve("other");
    await settle();
    await settle();

    const events = capture.stop();
    const codes = events.map(e => e.code);
    error.mockRestore();
    dispose();

    expect(views).toEqual(["fallback", "thing a"]);
    expect(codes).not.toContain("SETTLE_WALK_UNINITIALIZED_SOURCE");
    expect(error).not.toHaveBeenCalled();
  });

  it("shape B (no probe): memo mounted under a live action lane, re-run by a second optimistic write before its first landing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const capture = OBSERVE!.diagnostics.capture();

    const fetches: ReturnType<typeof deferred<string>>[] = [];
    const [id, setId] = createOptimistic(0);
    const [mount, setMount] = createSignal(false);
    const rendered: any[] = [];

    const dispose = createRoot(dispose => {
      createRenderEffect(
        () => id(),
        () => {}
      );
      createRenderEffect(
        () => {
          if (!mount()) return;
          const data = createMemo(() => {
            const current = id();
            const d = deferred<string>();
            fetches.push(d);
            return d.promise.then(() => "data for " + current);
          });
          createRenderEffect(
            () => data(),
            v => {
              rendered.push(v);
            }
          );
        },
        () => {}
      );
      return dispose;
    });
    flush();

    const gate = deferred<void>();
    const act = action(function* () {
      setId(1); // optimistic write inside an action → a live lane
      yield gate.promise;
    });
    const running = act();
    flush();
    setMount(true); // the component mounts while the lane is live
    flush();
    setId(2); // second optimistic write before the first landing → data is OPT-dirty on the lane
    flush();
    fetches[fetches.length - 1].resolve("x");
    await settle();

    const events = capture.stop();
    const codes = events.map(e => e.code);
    // the lane's readers see the derived result (A17) as soon as it lands
    expect(rendered).toEqual(["data for 2"]);

    gate.resolve();
    await running.catch(() => {});
    await settle();
    error.mockRestore();
    dispose();

    expect(rendered).toEqual(["data for 2"]);
    expect(codes).not.toContain("SETTLE_WALK_UNINITIALIZED_SOURCE");
    expect(error).not.toHaveBeenCalled();
  });

  it("shape B revert: the action throws while the node is uninitialized under its derived override — the revert re-derives it, nobody sees `undefined`", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const capture = OBSERVE!.diagnostics.capture();

    const fetches: ReturnType<typeof deferred<string>>[] = [];
    const [id, setId] = createOptimistic(0);
    const [mount, setMount] = createSignal(false);
    const rendered: any[] = [];
    const untracked: any[] = [];
    let data!: () => any;

    const dispose = createRoot(dispose => {
      createRenderEffect(
        () => id(),
        () => {}
      );
      createRenderEffect(
        () => {
          if (!mount()) return;
          data = createMemo(() => {
            const current = id();
            const d = deferred<string>();
            fetches.push(d);
            return d.promise.then(() => "data for " + current);
          });
          createRenderEffect(
            () => data(),
            v => {
              rendered.push(v);
            }
          );
        },
        () => {}
      );
      return dispose;
    });
    flush();

    const gate = deferred<void>();
    const act = action(function* () {
      setId(1);
      yield gate.promise;
    });
    const running = act();
    flush();
    setMount(true);
    flush();
    setId(2);
    flush();
    fetches[fetches.length - 1].resolve("x");
    await settle();
    expect(rendered).toEqual(["data for 2"]);
    expect(fetches.length).toBe(2);

    // The action fails. Its body has ended with nothing authoritative in
    // flight, so the truth at hand supersedes `id`'s override (A18 body-end,
    // #3427): `data` re-derives from `id = 0` on the plain channel — a fresh
    // flight — and the transaction holds until it lands, the display keeping
    // the optimistic frame meanwhile (A18 (c)). `data` is pending and still
    // uninitialized under its displayed derived override: an untracked read
    // is served the override — the displayed value of a pending node (A18
    // (d)) — never `undefined`, and never a hold (the "untracked read in the
    // window" case below pins the ruling).
    gate.reject(new Error("action failed"));
    await running.catch(() => {});
    await settle();
    expect(fetches.length).toBe(3);
    expect(rendered).toEqual(["data for 2"]);
    untracked.push(untrack(() => data()));
    expect(untracked).toEqual(["data for 2"]);

    fetches[fetches.length - 1].resolve("y");
    await settle();
    untracked.push(untrack(() => data()));

    const events = capture.stop();
    const codes = events.map(e => e.code);
    error.mockRestore();
    dispose();

    // the re-derivation from the truth lands, commits and reveals
    expect(rendered).toEqual(["data for 2", "data for 0"]);
    expect(untracked).not.toContain(undefined);
    expect(untracked[untracked.length - 1]).toBe("data for 0");
    expect(codes).not.toContain("SETTLE_WALK_UNINITIALIZED_SOURCE");
    expect(error).not.toHaveBeenCalled();
  });

  /**
   * A18 (d), ruled on the revert case above: a pending node that carries an
   * override DISPLAYS the override — the optimistic value shields the pending
   * state. "Uninitialized must suspend" (#3276, A19 exception 1) was written
   * for a node with nothing to show; a never-committed node with an armed
   * derived override has something to show. So an UNTRACKED read — no reader
   * identity, hence no lane membership to test — of a node that is
   * STATUS_UNINITIALIZED, pending, and under an armed derived override returns
   * the override. Before this, `read()`'s `!c && STATUS_UNINITIALIZED` throw
   * fired ahead of `serve()`'s override arm, so the read threw NotReadyError
   * in the body-end window while the same read of an INITIALIZED node
   * re-deriving under its override returned the override.
   *
   * Unchanged, pinned beside it: a tracked lane reader keeps the override
   * (A17 — `rendered` shows it throughout); a tracked OFF-LANE reader
   * mounted into the window suspends (#3651 — outsiders never see the lane's
   * values) and ends on the truth.
   */
  it("shape B revert: an untracked read of the never-committed node is served its derived override — before the revert, and in the re-derivation window; a tracked off-lane reader in the window still suspends", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const capture = OBSERVE!.diagnostics.capture();

    const fetches: ReturnType<typeof deferred<string>>[] = [];
    const [id, setId] = createOptimistic(0);
    const [mount, setMount] = createSignal(false);
    const [flag, setFlag] = createSignal(false);
    const rendered: any[] = [];
    const offLane: any[] = [];
    let data!: () => any;

    const dispose = createRoot(dispose => {
      createRenderEffect(
        () => id(),
        () => {}
      );
      createRenderEffect(
        () => {
          if (!mount()) return;
          data = createMemo(() => {
            const current = id();
            const d = deferred<string>();
            fetches.push(d);
            return d.promise.then(() => "data for " + current);
          });
          createRenderEffect(
            () => data(),
            v => {
              rendered.push(v);
            }
          );
        },
        () => {}
      );
      // an off-lane (mainline) tracked reader that first reads `data` when
      // flipped into the window
      createRenderEffect(
        () => (flag() ? data() : "off"),
        v => {
          offLane.push(v);
        }
      );
      return dispose;
    });
    flush();

    const gate = deferred<void>();
    const act = action(function* () {
      setId(1);
      yield gate.promise;
    });
    const running = act();
    flush();
    setMount(true);
    flush();
    setId(2);
    flush();
    fetches[fetches.length - 1].resolve("x");
    await settle();
    expect(rendered).toEqual(["data for 2"]);

    // Lane live, first landing under the lane: the node has never committed
    // (its value sits in the derived-override slot) and is not pending. An
    // untracked read displays the override (A17).
    expect(untrack(() => data())).toBe("data for 2");

    // The revert window (see the case above): `data` re-derives from the
    // truth on the plain channel, pending and still uninitialized, its
    // derived override still armed and displayed. An untracked read from
    // ambient context is served the override — not a NotReadyError, not
    // `undefined` (A18 (d)).
    gate.reject(new Error("action failed"));
    await running.catch(() => {});
    await settle();
    expect(fetches.length).toBe(3);
    expect(rendered).toEqual(["data for 2"]);
    expect(untrack(() => data())).toBe("data for 2");
    // Reading it did not settle, dispose or otherwise disturb the node: the
    // re-derivation is still the flight in the air, and a second read agrees.
    expect(fetches.length).toBe(3);
    expect(untrack(() => data())).toBe("data for 2");

    // A tracked OFF-LANE reader mounted into the window holds (#3651): it
    // publishes neither the override nor `undefined`, and re-derives when
    // the truth lands.
    setFlag(true);
    flush();
    await settle();
    expect(offLane).toEqual(["off"]);
    expect(rendered).toEqual(["data for 2"]);

    fetches[fetches.length - 1].resolve("y");
    await settle();
    const afterCommit = untrack(() => data());

    const events = capture.stop();
    const codes = events.map(e => e.code);
    error.mockRestore();
    dispose();

    expect(rendered).toEqual(["data for 2", "data for 0"]);
    expect(offLane).toEqual(["off", "data for 0"]);
    expect(afterCommit).toBe("data for 0");
    expect(codes).not.toContain("SETTLE_WALK_UNINITIALIZED_SOURCE");
    expect(error).not.toHaveBeenCalled();
  });
});
