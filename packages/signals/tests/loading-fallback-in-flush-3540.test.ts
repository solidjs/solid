/**
 * #3540 under L2: a fresh Loading mounted under a hold shows its fallback
 * (A29's boundary exemption; the fresh-mount part of the 2026-10-06
 * boundary-scope ruling).
 *
 * A first pass that reads a hold asks the boundaries up its chain
 * (`GlobalQueue._fresh`, the real `catchStatus` walk); when a loading
 * boundary that has not shown content catches it, the pass is the
 * boundary's, not the tick's: the boundary shows its fallback, the mount
 * publishes, and the content appears at the hold's commit. Outside such a
 * boundary, A15 and the direction rule are unchanged.
 *
 * Re-arm (`on`) under the boundary scope is deferred to a separate change,
 * pending its ruling: those shapes keep next's behavior and are pinned
 * `it.fails` with the ruled display.
 *
 * Each case is traced on the pre-L2 core (41fdf9696) too; the notes say
 * where it differs and the ruling that explains it. Sources: `held` — the
 * content reads `x`, written in an action that is still running; `flight`
 * — the content reads an async memo over `x`, refetching, which a revealed
 * Loading elsewhere holds. Logs within a step are sorted; `o`/`i`/`f`: the
 * readers recorded on the outer, inner and fresh boundaries; `pending o`:
 * `isPending` of that boundary's value.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  isPending,
  latest,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

/** `<Loading fallback={fallback} on={on}>{fn()}</Loading>`, created untracked
 * as createComponent does. */
const Loading = <T>(fn: () => T, fallback: string, on?: () => unknown) =>
  untrack(() => createLoadingBoundary(fn, () => fallback, on ? { on } : undefined));

/** The readers recorded on the boundary `owner` is under (internal). */
function readersOf(owner: object | undefined): number | undefined {
  if (!owner) return undefined;
  const context = (owner as { _context: Record<symbol, unknown> })._context;
  for (const key of Object.getOwnPropertySymbols(context)) {
    const b = context[key] as { _readers?: Set<unknown> } | null;
    if (b?._readers) return b._readers.size;
  }
  throw new Error("no boundary");
}

type Source = "held" | "flight";
type Content = "memo" | "direct" | "bound";

/** `x`, and what the content reads (see the header). */
function world(source: Source, log: string[]) {
  const [x, setX] = createSignal(0);
  const pending: (() => void)[] = [];
  let data: (() => number) | undefined;
  if (source === "flight") {
    data = createMemo(async () => {
      const v = x();
      await new Promise<void>(r => pending.push(r));
      return v;
    });
    const holder = Loading(() => `holder ${data!()}`, "holder fallback");
    createRenderEffect(holder, v => {
      log.push(v);
    });
  } else
    createRenderEffect(x, v => {
      log.push(`x ${v}`);
    });
  const settle = async () => {
    while (pending.length) pending.shift()!();
    await tick();
  };
  /** Writes `x` and holds it; resolves to the release. */
  const begin = () => {
    if (source === "flight") {
      setX(1);
      flush();
      return settle;
    }
    let release!: () => void;
    action(function* () {
      setX(1);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    return async () => {
      release();
      await tick();
    };
  };
  return { read: () => (data ? data() : x()), settle, begin };
}

/** The content over `read`: through a memo, directly, or bound by a render
 * effect (`<p>{m()}</p>` — the tree itself reads nothing). */
function content(kind: Content, read: () => number, log: string[], tag = "content") {
  return () => {
    if (kind === "direct") return `${tag} ${read()}`;
    const m = createMemo(() => `${tag} ${read()}`);
    if (kind === "memo") return m();
    createRenderEffect(m, v => {
      log.push(`text ${v}`);
    });
    return "p";
  };
}

type State = { log: string[]; readers: [string, number | undefined][]; pending: string[] };
const format = (s: State) =>
  [
    [...s.log].sort().join(" · "),
    ...(s.readers.length ? [s.readers.map(([k, n]) => k + n).join(" ")] : []),
    ...(s.pending.length ? [`pending ${s.pending.join("")}`] : [])
  ].join(" | ");

/** Steps: the mounting flush, the hold's release, the source settling (and,
 * for `gate`, the gate resolving). */
async function trace(
  steps: (() => Promise<unknown> | void)[],
  log: string[],
  readers: () => [string, number | undefined][] = () => [],
  pending: () => string[] = () => []
) {
  const out: string[] = [];
  let seen = 0;
  for (const step of steps) {
    await step();
    out.push(format({ log: log.slice(seen), readers: readers(), pending: pending() }));
    seen = log.length;
  }
  return out;
}

describe("#3540: a fresh Loading mounted over a held value", () => {
  // A held / flight, in a flush (a Show opening) — pre-L2 shows the
  // committed value (`open true · view content 0`) and updates at the
  // commit; L2 never serves content the committed value of a held node
  // (A29, it would tear): the boundary owns it, so it is pending and the
  // fallback shows now (the #3540 ruling). `next` holds the whole mount
  // (`open true` waits for the commit): the regression this fixes. From
  // mainline: as pre-L2 and next — the bound content too (`<p>{m()}</p>`:
  // the binding is pending under the boundary; `next` showed `p` with no
  // text until the commit).
  const expected: Record<string, string[]> = {
    "held memo flush": ["open true · view fallback", "view content 1 · x 1", ""],
    "held memo mainline": ["view fallback", "view content 1 · x 1", ""],
    "held direct flush": ["open true · view fallback", "view content 1 · x 1", ""],
    "held direct mainline": ["view fallback", "view content 1 · x 1", ""],
    "held bound flush": ["open true · view fallback", "text content 1 · view p · x 1", ""],
    "held bound mainline": ["view fallback", "text content 1 · view p · x 1", ""],
    "flight memo flush": ["open true · view fallback", "holder 1 · view content 1", ""],
    "flight memo mainline": ["view fallback", "holder 1 · view content 1", ""],
    "flight direct flush": ["open true · view fallback", "holder 1 · view content 1", ""],
    "flight direct mainline": ["view fallback", "holder 1 · view content 1", ""],
    "flight bound flush": ["open true · view fallback", "holder 1 · text content 1 · view p", ""],
    "flight bound mainline": ["view fallback", "holder 1 · text content 1 · view p", ""]
  };
  for (const source of ["held", "flight"] as Source[])
    for (const kind of ["memo", "direct", "bound"] as Content[])
      for (const where of ["flush", "mainline"])
        it(`${source}, content ${kind}, mounted from ${where === "flush" ? "a flush" : "mainline"}`, async () => {
          const log: string[] = [];
          const [open, setOpen] = createSignal(false);
          let w!: ReturnType<typeof world>;
          const mount = () => {
            const view = Loading(content(kind, w.read, log), "fallback");
            createRenderEffect(view, v => {
              log.push(`view ${v}`);
            });
          };
          createRoot(() => {
            w = world(source, log);
            if (where === "flush")
              createRenderEffect(
                () => (open() ? (mount(), true) : false),
                v => {
                  log.push(`open ${v}`);
                }
              );
          });
          flush();
          await w.settle();
          const end = w.begin();
          log.length = 0;
          const steps = [
            () => {
              if (where === "flush") setOpen(true);
              else createRoot(mount);
              flush();
            },
            end,
            w.settle
          ];
          expect(await trace(steps, log)).toEqual(expected[`${source} ${kind} ${where}`]);
        });

  for (const source of ["held", "flight"] as Source[])
    it(`${source}, nested under an outer Loading that has shown content: the inner fallback now, the outer keeps its content`, async () => {
      const log: string[] = [];
      const [open, setOpen] = createSignal(false);
      let w!: ReturnType<typeof world>;
      createRoot(() => {
        w = world(source, log);
        const outer = Loading(() => {
          createRenderEffect(
            () => {
              if (!open()) return false;
              const view = Loading(content("memo", w.read, log), "fallback");
              createRenderEffect(view, v => {
                log.push(`view ${v}`);
              });
              return true;
            },
            v => {
              log.push(`open ${v}`);
            }
          );
          return "outer";
        }, "outer fallback");
        createRenderEffect(outer, v => {
          log.push(`outer ${v}`);
        });
      });
      flush();
      await w.settle();
      const end = w.begin();
      log.length = 0;
      const steps = [() => (setOpen(true), flush()), end, w.settle];
      expect(await trace(steps, log)).toEqual([
        "open true · view fallback",
        source === "held" ? "view content 1 · x 1" : "holder 1 · view content 1",
        ""
      ]);
    });

  it("a derivation outside the boundary in the same flush still holds the tick (membership is the tick's)", async () => {
    const [x, setX] = createSignal(0);
    const [open, setOpen] = createSignal(false);
    const log: string[] = [];
    createRoot(() => {
      createRenderEffect(
        () => {
          if (!open()) return false;
          const label = createMemo(() => `label ${x()}`);
          createRenderEffect(label, v => {
            log.push(v);
          });
          const view = Loading(content("direct", x, log), "fallback");
          createRenderEffect(view, v => {
            log.push(`view ${v}`);
          });
          return true;
        },
        v => {
          log.push(`open ${v}`);
        }
      );
    });
    flush();
    let release!: () => void;
    action(function* () {
      setX(1);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    log.length = 0;

    setOpen(true);
    flush();
    expect(log).not.toContain("open true");
    expect(log.filter(l => l.startsWith("label"))).toEqual([]);

    release();
    await tick();
    expect(log).toContain("open true");
    expect(log).toContain("label 1");
    expect(log.at(-1)).toBe("view content 1");
  });

  // The label, created in the mount, reads the hold and joins it, so the
  // mount is part of the hold: the boundary mounted with it appears at the
  // commit, its fallback never seen (as a boundary under a held Show).
  // Not fixed here: the boundary's first pass still runs its fallback now
  // (`view fallback`), as on next.
  it.fails(
    "a boundary mounted by a pass that joined the hold appears at its commit, no fallback",
    async () => {
      const [x, setX] = createSignal(0);
      const [open, setOpen] = createSignal(false);
      const log: string[] = [];
      createRoot(() => {
        createRenderEffect(
          () => {
            if (!open()) return false;
            const label = createMemo(() => `label ${x()}`);
            createRenderEffect(label, v => {
              log.push(v);
            });
            const view = Loading(() => `content ${x()}`, "fallback");
            createRenderEffect(view, v => {
              log.push(`view ${v}`);
            });
            return true;
          },
          v => {
            log.push(`open ${v}`);
          }
        );
      });
      flush();
      let release!: () => void;
      action(function* () {
        setX(1);
        yield new Promise<void>(r => (release = r));
      })();
      flush();
      log.length = 0;

      setOpen(true);
      flush();
      expect(log).toEqual([]);

      release();
      await tick();
      expect([...log].sort()).toEqual(["label 1", "open true", "view content 1"]);
    }
  );

  it("the boundary's hold stays its own: a mount over another hold after the flush reveals at that hold's release", async () => {
    const [x, setX] = createSignal(0);
    const [y, setY] = createSignal(0);
    const [open, setOpen] = createSignal(false);
    const log: string[] = [];
    const view = (read: () => number, into: string[]) => {
      const v = Loading(() => `content ${read()}`, "fallback");
      createRenderEffect(v, s => {
        into.push(`view ${s}`);
      });
    };
    createRoot(() => {
      createRenderEffect(
        () => (open() ? (view(x, log), true) : false),
        v => {
          log.push(`open ${v}`);
        }
      );
    });
    flush();
    const hold = (write: () => void) => {
      let release!: () => void;
      action(function* () {
        write();
        yield new Promise<void>(r => (release = r));
      })();
      flush();
      return () => release();
    };
    const releaseX = hold(() => setX(1));
    const releaseY = hold(() => setY(1));
    log.length = 0;

    setOpen(true);
    flush();
    expect(log).toEqual(["view fallback", "open true"]);

    // Mounted from mainline, outside a flush, over y's hold only.
    const other: string[] = [];
    createRoot(() => view(y, other));
    flush();
    expect(other).toEqual(["view fallback"]);

    releaseY();
    await tick();
    expect(other).toEqual(["view fallback", "view content 1"]);
    expect(log).toEqual(["view fallback", "open true"]);

    releaseX();
    await tick();
    expect(log.at(-1)).toBe("view content 1");
  });
});

describe("#3540: the catcher is whoever `catchStatus` would catch at — at any depth, unchanged", () => {
  /**
   * A Show mounts a fresh computation in the flush, under `inner` (a
   * revealed Loading), inside `outer`:
   * - `unrevealed`: outer has not shown content (a gate sibling is loading);
   * - `rearmed outer`: outer revealed, its `on` reads the Show's signal;
   * - `revealed`: outer revealed, plain.
   * Or under one revealed Loading only: `rearmed` (its `on` reads the
   * Show's signal) or `plain`. Steps: the mount, the release, the source
   * settling, the gate.
   */
  type Shape = "unrevealed" | "rearmed outer" | "revealed" | "rearmed" | "plain";
  // The fresh pass's own catch walk (`_fresh`) records it on the revealed
  // boundaries it passes, as `catchStatus` records any pending read, and
  // its pending status is caught again by the normal path: one reader more
  // than next on each boundary passed until the commit, none after it.
  const expected: Record<string, string[]> = {
    // The ancestor catches, as pre-L2 (which also runs the binding behind
    // the fallback: `text fresh 0` — L2 holds a run behind a fallback,
    // 2026-10-02). Held or in flight alike: the content is pending, and the
    // boundaries on the way record it.
    "unrevealed held memo": [
      " | o2 i1",
      "x 1 | o1 i0",
      " | o1 i0",
      "gate gate · open fresh 1 · outer outer"
    ],
    "unrevealed held bound": [
      " | o2 i1",
      "x 1 | o1 i0",
      " | o1 i0",
      "gate gate · open p · outer outer · text fresh 1"
    ],
    "unrevealed flight memo": [
      " | o3 i2",
      "holder 1 | o1 i0",
      " | o1 i0",
      "gate gate · open fresh 1 · outer outer"
    ],
    "unrevealed flight bound": [
      " | o3 i2",
      "holder 1 | o1 i0",
      " | o1 i0",
      "gate gate · open p · outer outer · text fresh 1"
    ],
    // A re-armed ancestor: the content is pending and its fallback shows
    // now — nothing else holds the re-arming frame (#3575). In flight, as
    // pre-L2. Held (the ruled display, pinned `it.fails`: re-arm under the
    // boundary scope is deferred): pre-L2 shows the committed value
    // (`open fresh 0`, a tear under L2's A29); `next` holds the whole mount
    // for the commit.
    "rearmed outer held memo": [
      "outer outer fallback | o1 i1",
      "open fresh 1 · outer outer · x 1 | o0 i0",
      " | o0 i0",
      ""
    ],
    "rearmed outer held bound": [
      "outer outer fallback | o1 i1",
      "open p · outer outer · text fresh 1 · x 1 | o0 i0",
      " | o0 i0",
      ""
    ],
    "rearmed outer flight memo": [
      "outer outer fallback | o2 i2",
      "holder 1 · open fresh 1 · outer outer | o0 i0",
      " | o0 i0",
      ""
    ],
    "rearmed outer flight bound": [
      "outer outer fallback | o2 i2",
      "holder 1 · open p · outer outer · text fresh 1 | o0 i0",
      " | o0 i0",
      ""
    ],
    // The nearest boundary re-armed by the mounting flush: as the re-armed
    // ancestor.
    "rearmed held memo": [
      "inner inner fallback | i1",
      "inner inner · open fresh 1 · x 1 | i0",
      " | i0",
      ""
    ],
    "rearmed held bound": [
      "inner inner fallback | i1",
      "inner inner · open p · text fresh 1 · x 1 | i0",
      " | i0",
      ""
    ],
    "rearmed flight memo": [
      "inner inner fallback | i2",
      "holder 1 · inner inner · open fresh 1 | i0",
      " | i0",
      ""
    ],
    "rearmed flight bound": [
      "inner inner fallback | i2",
      "holder 1 · inner inner · open p · text fresh 1 | i0",
      " | i0",
      ""
    ],
    // No boundary would catch it: the mount joins the transaction and waits
    // for its commit, as on next. Pre-L2 shows the committed value now; L2
    // joins the hold (A29).
    "plain held memo": [" | i1", "open fresh 1 · x 1 | i0", " | i0", ""],
    "plain held bound": [" | i1", "open p · text fresh 1 · x 1 | i0", " | i0", ""],
    "plain flight memo": [" | i2", "holder 1 · open fresh 1 | i0", " | i0", ""],
    "plain flight bound": [" | i2", "holder 1 · open p · text fresh 1 | i0", " | i0", ""],
    "revealed held memo": [" | o1 i1", "open fresh 1 · x 1 | o0 i0", " | o0 i0", ""],
    "revealed held bound": [" | o1 i1", "open p · text fresh 1 · x 1 | o0 i0", " | o0 i0", ""],
    "revealed flight memo": [" | o2 i2", "holder 1 · open fresh 1 | o0 i0", " | o0 i0", ""],
    "revealed flight bound": [
      " | o2 i2",
      "holder 1 · open p · text fresh 1 | o0 i0",
      " | o0 i0",
      ""
    ]
  };
  for (const shape of ["unrevealed", "rearmed outer", "revealed", "rearmed", "plain"] as Shape[])
    for (const source of ["held", "flight"] as Source[])
      for (const kind of ["memo", "bound"] as Content[])
        // Re-arm over a held write: deferred to the re-arm change, pending its ruling.
        (source === "held" && shape.startsWith("rearmed") ? it.fails : it)(
          `${shape}, ${source}, content ${kind}`,
          async () => {
            const log: string[] = [];
            const [open, setOpen] = createSignal(false);
            let resolveGate: (() => void) | undefined;
            let w!: ReturnType<typeof world>;
            let outerOwner: object | undefined;
            let innerOwner!: object;
            let outer: (() => unknown) | undefined;
            let inner!: () => unknown;
            const innerFn = () => {
              innerOwner = getOwner()!;
              createRenderEffect(
                () => (open() ? content(kind, w.read, log, "fresh")() : false),
                v => {
                  log.push(`open ${v}`);
                }
              );
              return "inner";
            };
            const showInner = (on?: () => unknown) => {
              inner = Loading(innerFn, "inner fallback", on);
              createRenderEffect(inner, v => {
                log.push(`inner ${v}`);
              });
            };
            createRoot(() => {
              w = world(source, log);
              if (shape === "rearmed" || shape === "plain")
                return showInner(shape === "rearmed" ? open : undefined);
              outer = Loading(
                () => {
                  outerOwner = getOwner()!;
                  showInner();
                  if (shape === "unrevealed") {
                    const gate = createMemo(
                      () => new Promise<string>(r => (resolveGate = () => r("gate")))
                    );
                    createRenderEffect(gate, v => {
                      log.push(`gate ${v}`);
                    });
                  }
                  return "outer";
                },
                "outer fallback",
                shape === "rearmed outer" ? open : undefined
              );
              createRenderEffect(outer, v => {
                log.push(`outer ${v}`);
              });
            });
            flush();
            await w.settle();
            const end = w.begin();
            log.length = 0;
            const steps = [
              () => (setOpen(true), flush()),
              end,
              w.settle,
              async () => {
                resolveGate?.();
                await tick();
              }
            ];
            const readers = (): [string, number | undefined][] =>
              outer
                ? [
                    ["o", readersOf(outerOwner)],
                    ["i", readersOf(innerOwner)]
                  ]
                : [["i", readersOf(innerOwner)]];
            const pending = () => [
              ...(outer && isPending(() => outer!()) ? ["o"] : []),
              ...(isPending(() => inner()) ? ["i"] : [])
            ];
            const out = await trace(steps, log, readers, pending);
            // The gate step reports the log only.
            out[3] = out[3].split(" | ")[0];
            expect(out).toEqual(expected[`${shape} ${source} ${kind}`]);
          }
        );

  /**
   * A revealed outer Loading; a Show under it mounts, in the flush, a fresh
   * computation with a slow first load of its own, under an inner Loading
   * that has not shown content — or directly under the outer one. Steps:
   * the mount, the release, the slow load, the source settling.
   */
  for (const source of ["held", "flight"] as Source[])
    for (const withInner of [true, false])
      it(`outer revealed, ${withInner ? "inner unrevealed" : "no inner"}, ${source}: isPending and what the commit waits for`, async () => {
        const log: string[] = [];
        const [open, setOpen] = createSignal(false);
        let resolveSlow: (() => void) | undefined;
        let outerOwner!: object;
        let freshOwner: object | undefined;
        let outer!: () => unknown;
        let w!: ReturnType<typeof world>;
        createRoot(() => {
          w = world(source, log);
          outer = Loading(() => {
            outerOwner = getOwner()!;
            createRenderEffect(
              () => {
                if (!open()) return false;
                const body = () => {
                  freshOwner = getOwner()!;
                  const m = createMemo(async () => {
                    const v = w.read();
                    await new Promise<void>(r => (resolveSlow = r));
                    return `fresh ${v}`;
                  });
                  createRenderEffect(m, v => {
                    log.push(`text ${v}`);
                  });
                  return "p";
                };
                if (!withInner) return body();
                const view = Loading(body, "inner fallback");
                createRenderEffect(view, v => {
                  log.push(`inner ${v}`);
                });
                return true;
              },
              v => {
                log.push(`open ${v}`);
              }
            );
            return "outer";
          }, "outer fallback");
          createRenderEffect(outer, v => {
            log.push(`outer ${v}`);
          });
        });
        flush();
        await w.settle();
        const end = w.begin();
        log.length = 0;
        const slow = async () => {
          resolveSlow?.();
          await tick();
        };
        const steps = [() => (setOpen(true), flush()), end, slow, w.settle];
        const out = await trace(
          steps,
          log,
          () => [
            ["o", readersOf(outerOwner)],
            ["f", readersOf(freshOwner)]
          ],
          () => (isPending(() => outer()) ? ["o"] : [])
        );
        const x1 = source === "held" ? "x 1" : "holder 1";
        // Inner unrevealed: it catches; the outer records nothing, is never
        // pending, and the commit does not wait for the slow load — as
        // pre-L2 (`next` holds the Show's `open true` for the commit). No
        // inner: the mount joins the transaction and the commit waits for
        // the slow load, as on next; pre-L2 commits `x` first (held: L2's
        // A29 — the mount is the hold's). (Reader counts: see `expected`
        // above — the fresh pass's catch walk records it once more.)
        expect(out).toEqual(
          withInner
            ? [
                "inner inner fallback · open true | o0 f2",
                `${x1} | o0 f2`,
                "inner p · text fresh 1 | o0 f0",
                " | o0 f0"
              ]
            : [
                " | o2 f2",
                " | o2 f2",
                [x1, "open p", "text fresh 1"].sort().join(" · ") + " | o0 f0",
                " | o0 f0"
              ]
        );
      });
});

describe("#3540: the boundary scope — committed content, held mounts, no catcher, verdicts", () => {
  const verdict = (fn: () => unknown, how: "pending" | "latest") => {
    try {
      return String(how === "pending" ? isPending(fn) : latest(fn));
    } catch (e) {
      return `throws ${(e as Error).constructor.name}`;
    }
  };
  /** Steps: the change, the hold's commit, the source settling — each the
   * log since the last (sorted) and `state()`. */
  async function steps(
    log: string[],
    w: ReturnType<typeof world>,
    change: () => void,
    state: () => Record<string, unknown>
  ) {
    const end = w.begin();
    log.length = 0;
    const out: string[] = [];
    let seen = 0;
    const take = () => {
      const s = Object.entries(state())
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      out.push(`${[...log.slice(seen)].sort().join(" · ")} | ${s}`);
      seen = log.length;
    };
    change();
    flush();
    take();
    await end();
    take();
    await w.settle();
    take();
    return out;
  }

  // A fresh boundary mounted over the hold (memo content). While its
  // fallback shows, its value is not pending (nothing stale is shown).
  // `latest` of the content: held, the derivation staged in the hold
  // (`content 1`, A11, as next serves it); in flight, the content has no
  // value yet and throws, as for any first load. Pre-L2 serves the
  // committed or staged value (`content 0` in a flush, a tear under A29;
  // `content 1` from mainline); `next` reports the boundary pending while
  // it holds the mount. (Readers: the content's catch walk records it once
  // more than the normal path, until the commit.)
  const observe = (source: Source, x1: string) => [
    `view fallback | readers=2 view=false m=false latest=${source === "held" ? "content 1" : "throws NotReadyError"}`,
    `${[x1, "view content 1"].sort().join(" · ")} | readers=0 view=false m=false latest=content 1`,
    " | readers=0 view=false m=false latest=content 1"
  ];
  for (const source of ["held", "flight"] as Source[])
    for (const where of ["flush", "mainline"])
      it(`${source}, a fresh boundary from ${where}: isPending and latest`, async () => {
        const log: string[] = [];
        const [open, setOpen] = createSignal(false);
        let w!: ReturnType<typeof world>;
        let m: (() => string) | undefined;
        let view: (() => unknown) | undefined;
        let owner: object | undefined;
        const mount = () => {
          view = Loading(() => {
            owner = getOwner()!;
            m = createMemo(() => `content ${w.read()}`);
            return m();
          }, "fallback");
          createRenderEffect(view, v => {
            log.push(`view ${v}`);
          });
        };
        createRoot(() => {
          w = world(source, log);
          if (where === "flush")
            createRenderEffect(
              () => (open() ? (mount(), true) : false),
              v => {
                log.push(`open ${v}`);
              }
            );
        });
        flush();
        await w.settle();
        const out = await steps(
          log,
          w,
          () => (where === "flush" ? setOpen(true) : createRoot(mount)),
          () => ({
            readers: readersOf(owner),
            view: verdict(() => view!(), "pending"),
            m: verdict(() => m!(), "pending"),
            latest: verdict(() => m!(), "latest")
          })
        );
        const expected = observe(source, source === "held" ? "x 1" : "holder 1");
        if (where === "flush")
          expected[0] = expected[0].replace("view fallback", "open true · view fallback");
        expect(out).toEqual(expected);
      });

  // Committed content under a revealed boundary, re-run by a plain write
  // to `key` while the hold is up. With `on: key` the boundary is re-armed
  // and owns its subtree: the content that reads the hold waits behind the
  // fallback, and the hold does not wait for it (the ruled display, pinned
  // `it.fails`: re-arm under the boundary scope is deferred). Pre-L2 and
  // `next` show no fallback: the content joins the hold (`next` reports the
  // boundary pending). Without `on`: A15, the content joins the hold — as
  // pre-L2 and next. (`memo`:
  // the boundary's own render reads `m`, so its re-run creates a fresh
  // memo — no value until it loads; `bound`: the binding re-runs over the
  // committed memo, pending with its committed value.)
  const committed: Record<string, string[]> = {
    "held rearmed memo": [
      "view fallback | readers=1 view=false m=false latest=throws NotReadyError",
      "view c1 1 · x 1 | readers=0 view=false m=false latest=c1 1",
      " | readers=0 view=false m=false latest=c1 1"
    ],
    "held rearmed bound": [
      "view fallback | readers=1 view=false m=true latest=c0 0",
      "text c1 1 · view p · x 1 | readers=0 view=false m=false latest=c1 1",
      " | readers=0 view=false m=false latest=c1 1"
    ],
    "held plain memo": [
      // The boundary's render creates a fresh memo; its catch walk records it.
      " | readers=1 view=true m=false latest=c1 1",
      "view c1 1 · x 1 | readers=0 view=false m=false latest=c1 1",
      " | readers=0 view=false m=false latest=c1 1"
    ],
    "held plain bound": [
      " | readers=0 view=false m=true latest=c1 1",
      "text c1 1 · x 1 | readers=0 view=false m=false latest=c1 1",
      " | readers=0 view=false m=false latest=c1 1"
    ],
    "flight rearmed memo": [
      "view fallback | readers=1 view=false m=true latest=c0 0",
      "holder 1 · view c1 1 | readers=0 view=false m=false latest=c1 1",
      " | readers=0 view=false m=false latest=c1 1"
    ],
    "flight rearmed bound": [
      "view fallback | readers=1 view=false m=true latest=c0 0",
      "holder 1 · text c1 1 · view p | readers=0 view=false m=false latest=c1 1",
      " | readers=0 view=false m=false latest=c1 1"
    ],
    "flight plain memo": [
      " | readers=1 view=true m=true latest=c0 0",
      "holder 1 · view c1 1 | readers=0 view=false m=false latest=c1 1",
      " | readers=0 view=false m=false latest=c1 1"
    ],
    "flight plain bound": [
      " | readers=1 view=false m=true latest=c0 0",
      "holder 1 · text c1 1 | readers=0 view=false m=false latest=c1 1",
      " | readers=0 view=false m=false latest=c1 1"
    ]
  };
  for (const source of ["held", "flight"] as Source[])
    for (const withOn of [true, false])
      for (const kind of ["memo", "bound"] as Content[])
        // Re-arm over committed content: deferred to the re-arm change, pending its ruling.
        (withOn ? it.fails : it)(
          `${source}, committed content ${withOn ? "under a re-armed boundary" : "under a plain boundary"}, ${kind}`,
          async () => {
            const log: string[] = [];
            const [key, setKey] = createSignal(0);
            let w!: ReturnType<typeof world>;
            let m!: () => string;
            let view!: () => unknown;
            let owner: object | undefined;
            createRoot(() => {
              w = world(source, log);
              view = Loading(
                () => {
                  owner = getOwner()!;
                  m = createMemo(() => `c${key()} ${w.read()}`);
                  if (kind === "memo") return m();
                  createRenderEffect(m, v => {
                    log.push(`text ${v}`);
                  });
                  return "p";
                },
                "fallback",
                withOn ? key : undefined
              );
              createRenderEffect(view, v => {
                log.push(`view ${v}`);
              });
            });
            flush();
            await w.settle();
            const out = await steps(
              log,
              w,
              () => setKey(1),
              () => ({
                readers: readersOf(owner),
                view: verdict(() => view(), "pending"),
                m: verdict(() => m(), "pending"),
                latest: verdict(() => m(), "latest")
              })
            );
            expect(out).toEqual(committed[`${source} ${withOn ? "rearmed" : "plain"} ${kind}`]);
          }
        );

  // A boundary mounted as part of the hold — `<Show when={x()}>`'s memo
  // creates it, at top level or in a revealed boundary: it appears at the
  // hold's commit, its fallback never seen — as pre-L2. (In flight `next`
  // flashes the fallback at the commit; not fixed here, pinned `it.fails`.)
  for (const source of ["held", "flight"] as Source[])
    for (const nested of [false, true])
      (source === "flight" ? it.fails : it)(
        `${source}, a boundary mounted by the hold${nested ? ", nested" : ""}: no fallback, it appears at the commit`,
        async () => {
          const log: string[] = [];
          let w!: ReturnType<typeof world>;
          let view: (() => unknown) | undefined;
          let shown!: () => unknown;
          createRoot(() => {
            w = world(source, log);
            const body = () => {
              shown = createMemo(() => {
                if (w.read() < 1) return null;
                return (view = Loading(() => `content ${w.read()}`, "fallback"));
              });
              createRenderEffect(
                () => {
                  const v = shown() as (() => unknown) | null;
                  return v ? v() : "none";
                },
                v => {
                  log.push(`view ${v}`);
                }
              );
              return "outer";
            };
            if (!nested) return body();
            const outer = Loading(body, "outer fallback");
            createRenderEffect(outer, v => {
              log.push(`outer ${v}`);
            });
          });
          flush();
          await w.settle();
          const out = await steps(
            log,
            w,
            () => {},
            () => ({
              view: view ? verdict(() => view!(), "pending") : "-",
              shown: verdict(() => shown(), "pending")
            })
          );
          const v0 = source === "held" ? "false" : "-";
          expect(out).toEqual([
            ` | view=${v0} shown=true`,
            `${source === "held" ? "view content 1 · x 1" : "holder 1 · view content 1"} | view=false shown=false`,
            " | view=false shown=false"
          ]);
        }
      );

  // No boundary would catch it: a fresh mount reading the hold joins it
  // and waits for its commit (A15), as on next. Pre-L2 shows the committed
  // value in a flush (`text fresh 0`).
  for (const source of ["held", "flight"] as Source[])
    for (const where of ["flush", "mainline"])
      it(`${source}, no catcher, from ${where}: the mount joins the hold`, async () => {
        const log: string[] = [];
        const [open, setOpen] = createSignal(false);
        let w!: ReturnType<typeof world>;
        let m: (() => string) | undefined;
        const mount = () => {
          m = createMemo(() => `fresh ${w.read()}`);
          createRenderEffect(m, v => {
            log.push(`text ${v}`);
          });
        };
        createRoot(() => {
          w = world(source, log);
          if (where === "flush")
            createRenderEffect(
              () => (open() ? (mount(), true) : false),
              v => {
                log.push(`open ${v}`);
              }
            );
        });
        flush();
        await w.settle();
        const out = await steps(
          log,
          w,
          () => (where === "flush" ? setOpen(true) : createRoot(mount)),
          () => ({
            m: verdict(() => m!(), "pending"),
            latest: verdict(() => m!(), "latest")
          })
        );
        const first = source === "held" ? "fresh 1" : "throws NotReadyError";
        const landed = [
          source === "held" ? "x 1" : "holder 1",
          ...(where === "flush" ? ["open true"] : []),
          "text fresh 1"
        ].sort();
        expect(out).toEqual([
          ` | m=false latest=${first}`,
          `${landed.join(" · ")} | m=false latest=fresh 1`,
          " | m=false latest=fresh 1"
        ]);
      });
});

describe("#3540: the boundary scope — semantic fuzzer findings (rev 19, seed 91501)", () => {
  const drain = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  // branch-boundaries #870, reduced. An `on` re-arm leaves the tree held by
  // an earlier hold, the content it staged there stale: the output's read
  // of it is a read of content the boundary owns, so the tree leaves the
  // transaction and re-derives (pending under the boundary) rather than
  // being recorded as a settled reader — which redrew the boundary forever.
  // Re-arm under the boundary scope is deferred, pending its ruling: next's
  // display here is the held content, no fallback.
  it.fails("a held tree under a re-armed boundary re-derives — no redraw loop", async () => {
    const [s1, setS1] = createSignal(0);
    const [s2, setS2] = createSignal(0);
    const [visible, setShow] = createSignal(true);
    const flights: (() => void)[] = [];
    const log: unknown[] = [];
    createRoot(() => {
      const node = createMemo(async () => {
        const v = s2();
        await new Promise<void>(r => flights.push(r));
        return v;
      });
      const view = Loading(() => (visible() ? `${s1()} ${s2()}` : "hidden"), "loading", s1);
      createRenderEffect(view, v => {
        log.push(`view ${v}`);
      });
      createRenderEffect(node, v => {
        log.push(`node ${v}`);
      });
    });
    flush();
    while (flights.length) flights.shift()!();
    await drain();
    flush();
    log.length = 0;
    setS1(1);
    flush();
    setS2(1);
    setShow(false);
    flush();
    setS1(0);
    flush();
    expect(log).toEqual(["view 1 0", "view loading"]);
    setS2(0);
    flush();
    await drain();
    expect(log).toEqual(["view 1 0", "view loading"]);
  });

  // boundaries #1078, reduced. An `on` re-arm over content staged in a
  // hold, then a hide, in a flush that an async memo of that hold (read
  // outside) joins to it: the content staged before the re-arm must not be
  // published at the hold's landing, after the hide.
  it("hidden after a re-arm over a held mount: the boundary does not publish stale content", async () => {
    const w = seamWorld((s1, visible) => [
      Loading(() => (visible() ? `content ${s1()}` : "hidden"), "loading", s1)
    ]);
    await w.mount();
    await w.turn(() => w.setS1(0));
    await w.turn(() => w.setShow(false));
    await w.settle();
    expect(w.log).toEqual(["0:hidden"]);
  });
});

/** The #1078 world: `n1`, async over `s1`, is read by a render effect
 * outside the boundaries while `visible`. Mounted with `s1` = 1 committed
 * and `setShow(true)` held by `n1`'s flight: the boundaries' content
 * (`content 1`) is staged in that hold, the screen still `hidden`. `s1` is
 * every boundary's `on`; writing it re-arms them, and re-asks `n1` — the
 * flush joins the hold after the boundaries' content has read it. `log`:
 * what each boundary shows, from the hold on. */
function seamWorld(boundaries: (s1: () => number, visible: () => boolean) => (() => unknown)[]) {
  const drain = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const [s1, setS1] = createSignal(0);
  const [visible, setShow] = createSignal(false);
  const flights: (() => void)[] = [];
  const log: string[] = [];
  createRoot(() => {
    const n0 = createMemo(() => s1());
    const n1 = createMemo(async () => {
      const v = n0();
      await new Promise<void>(r => flights.push(r));
      return v;
    });
    boundaries(s1, visible).forEach((view, i) =>
      createRenderEffect(view, v => {
        log.push(`${i}:${v}`);
      })
    );
    createRenderEffect(
      () => (visible() ? n1() : "hidden"),
      () => {}
    );
  });
  const turn = async (fn: () => void) => {
    fn();
    flush();
    await drain();
    flush();
  };
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      while (flights.length) flights.shift()!();
      await turn(() => {});
    }
  };
  const mount = async () => {
    await turn(() => {});
    await settle();
    await turn(() => setS1(1));
    await turn(() => setShow(true));
    log.length = 0;
  };
  return { setS1, setShow, log, turn, settle, mount };
}

// A re-arm whose content reads a hold, in a flush that then joins that
// hold: the re-armed content enters the hold and appears at its commit, no
// fallback committed with the hold — as pre-L2 and next.
describe("#3540: a read made pending before the flush joins its hold", () => {
  it("one boundary: the content appears at the hold's commit, no fallback", async () => {
    const w = seamWorld((s1, visible) => [
      Loading(() => (visible() ? `content ${s1()}` : "hidden"), "loading", s1)
    ]);
    await w.mount();
    await w.turn(() => w.setS1(0));
    expect(w.log).toEqual([]);
    await w.settle();
    expect(w.log).toEqual(["0:content 0"]);
  });

  it("two boundaries re-armed by the same change: neither shows its fallback", async () => {
    const w = seamWorld((s1, visible) => [
      Loading(() => (visible() ? `a ${s1()}` : "hidden"), "loading", s1),
      Loading(() => (visible() ? `b ${s1()}` : "hidden"), "loading", s1)
    ]);
    await w.mount();
    await w.turn(() => w.setS1(0));
    expect(w.log).toEqual([]);
    await w.settle();
    expect(w.log.sort()).toEqual(["0:a 0", "1:b 0"]);
  });

  it("two boundaries, then a hide: both land hidden", async () => {
    const w = seamWorld((s1, visible) => [
      Loading(() => (visible() ? `a ${s1()}` : "hidden"), "loading", s1),
      Loading(() => (visible() ? `b ${s1()}` : "hidden"), "loading", s1)
    ]);
    await w.mount();
    await w.turn(() => w.setS1(0));
    await w.turn(() => w.setShow(false));
    await w.settle();
    expect(w.log.sort()).toEqual(["0:hidden", "1:hidden"]);
  });

  it("nested: neither the inner nor the outer fallback shows", async () => {
    const w = seamWorld((s1, visible) => {
      const outer = Loading(
        () => {
          const inner = Loading(() => (visible() ? `in ${s1()}` : "hidden"), "inner", s1);
          return () => `out[${inner()}]`;
        },
        "outer",
        s1
      );
      return [outer];
    });
    await w.mount();
    await w.turn(() => w.setS1(0));
    expect(w.log).toEqual([]);
    await w.settle();
    expect(w.log).toEqual(["0:out[in 0]"]);
  });

  it("nested, then a hide: lands hidden", async () => {
    const w = seamWorld((s1, visible) => {
      const outer = Loading(
        () => {
          const inner = Loading(() => (visible() ? `in ${s1()}` : "hidden"), "inner", s1);
          return () => `out[${inner()}]`;
        },
        "outer",
        s1
      );
      return [outer];
    });
    await w.mount();
    await w.turn(() => w.setS1(0));
    await w.turn(() => w.setShow(false));
    await w.settle();
    expect(w.log).toEqual(["0:out[hidden]"]);
  });

  it("re-armed twice under the hold: the last content appears at the commit", async () => {
    const w = seamWorld((s1, visible) => [
      Loading(() => (visible() ? `content ${s1()}` : "hidden"), "loading", s1)
    ]);
    await w.mount();
    await w.turn(() => w.setS1(0));
    await w.turn(() => w.setS1(2));
    expect(w.log).toEqual([]);
    await w.settle();
    expect(w.log).toEqual(["0:content 2"]);
  });

  // boundaries #476/#1674 (rev 19, seed 91501), reduced. `show` is held by
  // `n1`'s flight, which the boundary's content forwards; `s = 0` re-arms
  // the boundary and starts `n2`, which a reader outside reads. The hold
  // must not land at once — `show` true beside content derived from `show`
  // false — with the fallback a frame later.
  it("a swap parked with another change takes the hold its content read with it", async () => {
    const drain = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    const [s, setS] = createSignal(0);
    const [visible, setShow] = createSignal(false);
    const manual: (() => void)[] = [];
    const frame: Record<string, unknown> = {};
    createRoot(() => {
      const n0 = createMemo(() => s());
      const n1 = createMemo(() => {
        const v = n0();
        return new Promise<number>(r => manual.push(() => r(v)));
      });
      const n2 = createMemo(() => Promise.resolve(s()));
      createRenderEffect(visible, v => {
        frame.show = v;
      });
      const view = Loading(() => (visible() ? `content ${n1()}` : "hidden"), "loading", s);
      createRenderEffect(view, v => {
        frame.view = v;
      });
      createRenderEffect(
        () => `outside ${n2()}`,
        v => {
          frame.outside = v;
        }
      );
    });
    const turn = async (fn: () => void) => {
      fn();
      flush();
      const after = { ...frame };
      await drain();
      flush();
      return [after, { ...frame }];
    };
    await turn(() => {});
    manual.shift()!();
    await turn(() => {});
    await turn(() => setS(1));
    await turn(() => setShow(true));
    expect(frame).toEqual({ show: false, view: "hidden", outside: "outside 1" });
    expect(await turn(() => setS(0))).toEqual([
      { show: false, view: "hidden", outside: "outside 1" },
      { show: true, view: "loading", outside: "outside 0" }
    ]);
    while (manual.length) manual.shift()!();
    await turn(() => {});
    expect(frame).toEqual({ show: true, view: "content 0", outside: "outside 0" });
  });

  // boundaries #1674 (rev 19, seed 91501), reduced again. `show` is held
  // only by the content under the boundary; `s = 0` re-arms it. A reader
  // outside goes pending on `n2`, which `s = 0` started. Here, as on next,
  // the re-arm's content joins the hold, so the hold lands with the change
  // and nothing tears. Under the deferred re-arm scope the re-armed
  // boundary would release the hold at once, and the reader re-derived at
  // that landing would keep showing "hidden" beside the landed `show` —
  // A15's landing tear, the same as boundaries #75's reduction without any
  // boundary (which fails on next too).
  it("a re-arm over held content, beside a reader pending on the change: no tear", async () => {
    const drain = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    const [s, setS] = createSignal(0);
    const [visible, setShow] = createSignal(true);
    const manual: (() => void)[] = [];
    const frames: Record<string, unknown>[] = [];
    const frame: Record<string, unknown> = {};
    createRoot(() => {
      const n0 = createMemo(() => s());
      const n1 = createMemo(() => {
        const v = n0();
        return new Promise<number>(r => manual.push(() => r(v)));
      });
      const n2 = createMemo(() => Promise.resolve(n0()));
      createRenderEffect(visible, v => {
        frame.show = v;
      });
      createRenderEffect(
        () => (visible() ? `outside ${s()} ${n2()}` : "hidden"),
        v => {
          frame.outside = v;
        }
      );
      const view = Loading(() => (visible() ? `content ${n1()}` : "hidden"), "loading", s);
      createRenderEffect(view, v => {
        frame.view = v;
      });
    });
    const turn = async (fn: () => void) => {
      fn();
      flush();
      frames.push({ ...frame });
      await drain();
      flush();
      frames.push({ ...frame });
    };
    await turn(() => {});
    manual.shift()!();
    await turn(() => {});
    await turn(() => {
      setShow(false);
      setS(1);
    });
    await turn(() => setShow(true));
    await turn(() => setS(0));
    while (manual.length) {
      manual.shift()!();
      await turn(() => {});
    }
    expect(frames.filter(f => f.show === true && f.outside === "hidden")).toEqual([]);
  });

  it("re-armed twice, then a hide: lands hidden", async () => {
    const w = seamWorld((s1, visible) => [
      Loading(() => (visible() ? `content ${s1()}` : "hidden"), "loading", s1)
    ]);
    await w.mount();
    await w.turn(() => w.setS1(0));
    await w.turn(() => w.setS1(2));
    await w.turn(() => w.setShow(false));
    await w.settle();
    expect(w.log).toEqual(["0:hidden"]);
  });
});
