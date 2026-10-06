/**
 * #3540 under L2 — A29's boundary exemption, in a flush and on a hold.
 *
 * A loading boundary that has not shown content mounted while a transaction
 * holds what it reads shows its fallback now and its content at the commit:
 * the first pass under it is the boundary's, not the tick's. A mount inside
 * a flush (a Show opening) publishes with it; a derivation outside the
 * boundary in the same flush still holds the tick. Content bound by a render
 * effect (the tree never reads the held value) is collected too, so the
 * boundary never reveals empty content.
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
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
};

function hold(write: () => void) {
  let release!: () => void;
  action(function* () {
    write();
    yield new Promise<void>(resolve => (release = resolve));
  })();
  flush();
  return () => release();
}

/** `<Loading fallback={fallback}>{fn()}</Loading>`, created untracked as
 * createComponent does. */
const Loading = <T>(fn: () => T, fallback: string) =>
  untrack(() => createLoadingBoundary(fn, () => fallback));

type Content = "memo" | "direct" | "bound";

/** The boundary's content over `x`, logging into `log`. */
function content(kind: Content, x: () => number, log: string[]) {
  return () => {
    if (kind === "direct") return `content ${x()}`;
    const m = createMemo(() => `content ${x()}`);
    if (kind === "memo") return m();
    // <p>{m()}</p>: the content's binding reads the memo, the tree does not.
    createRenderEffect(m, v => {
      log.push(`text ${v}`);
    });
    return "p";
  };
}

function mount(kind: Content, x: () => number, log: string[]) {
  const view = Loading(content(kind, x, log), "fallback");
  createRenderEffect(view, v => {
    log.push(`view ${v}`);
  });
}

const shapes = [
  ["memo", "through a memo"],
  ["direct", "directly"],
  ["bound", "bound by a render effect under the boundary"]
] as const;

/** The commit's reveal: the content's own entries, in any order. */
const revealed = (kind: Content) =>
  kind === "bound" ? ["text content 1", "view p"] : ["view content 1"];

describe("#3540 in a flush: a fresh Loading mounted over a held value shows its fallback now", () => {
  function setup(kind: Content, nested = false) {
    const [x, setX] = createSignal(0);
    const [open, setOpen] = createSignal(false);
    const log: string[] = [];
    createRoot(() => {
      createRenderEffect(x, v => {
        log.push(`x ${v}`);
      });
      // <Show when={open()}><Loading fallback="fallback"><Content/></Loading></Show>
      const show = () =>
        createRenderEffect(
          () => {
            if (!open()) return false;
            mount(kind, x, log);
            return true;
          },
          v => {
            log.push(`open ${v}`);
          }
        );
      if (!nested) return show();
      // Under an outer Loading that has shown content.
      const outer = Loading(() => (show(), "outer"), "outer fallback");
      createRenderEffect(outer, v => {
        log.push(`outer ${v}`);
      });
    });
    flush();
    if (nested) expect(log).toContain("outer outer");
    const release = hold(() => setX(1));
    log.length = 0;
    return { setOpen, log, release };
  }

  for (const [kind, how] of shapes)
    it(`content reads the held value ${how}: the mount publishes, the content reveals at the commit`, async () => {
      const s = setup(kind);
      s.setOpen(true);
      flush();
      expect(s.log).toEqual(["view fallback", "open true"]);

      s.release();
      await tick();
      expect(s.log.slice(2).sort()).toEqual(["x 1", ...revealed(kind)].sort());
    });

  it("nested under an outer Loading that has shown content: the inner fallback now, the outer keeps its content", async () => {
    const s = setup("memo", true);
    s.setOpen(true);
    flush();
    expect(s.log).toEqual(["view fallback", "open true"]);

    s.release();
    await tick();
    expect(s.log.slice(2).sort()).toEqual(["view content 1", "x 1"]);
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
          mount("direct", x, log);
          return true;
        },
        v => {
          log.push(`open ${v}`);
        }
      );
    });
    flush();
    const release = hold(() => setX(1));
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

  it("the boundary's hold stays its own: a mount over another hold after the flush reveals at that hold's release", async () => {
    const [x, setX] = createSignal(0);
    const [y, setY] = createSignal(0);
    const [open, setOpen] = createSignal(false);
    const log: string[] = [];
    createRoot(() => {
      createRenderEffect(
        () => {
          if (!open()) return false;
          mount("direct", x, log);
          return true;
        },
        v => {
          log.push(`open ${v}`);
        }
      );
    });
    flush();
    const releaseX = hold(() => setX(1));
    const releaseY = hold(() => setY(1));
    log.length = 0;

    setOpen(true);
    flush();
    expect(log).toEqual(["view fallback", "open true"]);

    // Mounted from mainline, outside a flush, over y's hold only.
    const other: string[] = [];
    createRoot(() => mount("direct", y, other));
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

describe("#3540 on a hold: a fresh Loading mounted from mainline over a held value", () => {
  for (const [kind, how] of shapes)
    it(`content reads the held value ${how}: the fallback now, the content at the commit`, async () => {
      const [x, setX] = createSignal(0);
      const release = hold(() => setX(1));
      const log: string[] = [];
      createRoot(() => mount(kind, x, log));
      flush();
      expect(log).toEqual(["view fallback"]);

      release();
      await tick();
      expect(log.slice(1).sort()).toEqual(revealed(kind).sort());
    });
});

/** The readers recorded on the boundary `owner` is under (internal: the
 * catch's registrations). */
function readersOf(owner: object): number {
  const context = (owner as { _context: Record<symbol, unknown> })._context;
  for (const key of Object.getOwnPropertySymbols(context)) {
    const b = context[key] as { _readers?: Set<unknown> } | null;
    if (b?._readers) return b._readers.size;
  }
  throw new Error("no boundary");
}

describe("#3540: the first-pass catch belongs to the boundary that has not shown content, and to no other", () => {
  /**
   * A revealed outer `Loading`; a transaction holding `x`; a Show under the
   * outer one mounts, in a flush, a fresh computation over `x` with a first
   * load of its own (`slow`) — under an inner `Loading` that has not shown
   * content (`inner`), or directly under the revealed outer one.
   */
  function setup(inner: boolean) {
    const [x, setX] = createSignal(0);
    const [open, setOpen] = createSignal(false);
    const log: string[] = [];
    let resolveSlow!: () => void;
    let outerOwner!: object;
    let freshOwner!: object;
    let outer!: () => unknown;
    createRoot(() => {
      createRenderEffect(x, v => {
        log.push(`x ${v}`);
      });
      outer = Loading(() => {
        outerOwner = getOwner()!;
        createRenderEffect(
          () => {
            if (!open()) return false;
            const body = () => {
              freshOwner = getOwner()!;
              const m = createMemo(async () => {
                const v = x();
                await new Promise<void>(r => (resolveSlow = r));
                return `fresh ${v}`;
              });
              createRenderEffect(m, v => {
                log.push(`text ${v}`);
              });
              return "p";
            };
            if (!inner) return body();
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
    expect(log).toEqual(["x 0", "open false", "outer outer"]);
    const release = hold(() => setX(1));
    log.length = 0;
    setOpen(true);
    flush();
    const state = () => ({
      log: [...log],
      outerPending: isPending(() => outer()),
      outerReaders: readersOf(outerOwner),
      freshReaders: readersOf(freshOwner)
    });
    return { release, resolve: () => resolveSlow(), state };
  }

  it("under an inner Loading that has not shown content: the inner one catches it; the outer one records nothing, is not pending, and the commit does not wait for it", async () => {
    const s = setup(true);
    expect(s.state()).toEqual({
      log: ["inner inner fallback", "open true"],
      outerPending: false,
      outerReaders: 0,
      freshReaders: 2
    });

    s.release();
    await tick();
    // The transaction commits without the fresh computation's first load.
    expect(s.state()).toMatchObject({
      log: ["inner inner fallback", "open true", "x 1"],
      outerPending: false,
      outerReaders: 0
    });

    s.resolve();
    await tick();
    expect(s.state()).toEqual({
      log: ["inner inner fallback", "open true", "x 1", "text fresh 1", "inner p"],
      outerPending: false,
      outerReaders: 0,
      freshReaders: 0
    });
  });

  it("directly under the revealed Loading (none has not shown content): not caught — it joins the transaction, as on next", async () => {
    const s = setup(false);
    const trace: unknown[] = [s.state()];
    s.release();
    await tick();
    trace.push(s.state());
    s.resolve();
    await tick();
    trace.push(s.state());
    // The Show's mount waits with the transaction, the outer content stays,
    // and the outer boundary holds the one pending reader the frame
    // forwarded (the memo) — never the born-held binding.
    const held = { log: [], outerPending: false, outerReaders: 1, freshReaders: 1 };
    expect(trace).toEqual([
      held,
      held,
      {
        log: ["text fresh 1", "x 1", "open p"],
        outerPending: false,
        outerReaders: 0,
        freshReaders: 0
      }
    ]);
  });

  it("under a revealed Loading inside one that has not shown content: the nearest one is asked only — not caught, as on next", async () => {
    const [x, setX] = createSignal(0);
    const [open, setOpen] = createSignal(false);
    let resolveGate!: () => void;
    const log: string[] = [];
    let outerOwner!: object;
    let innerOwner!: object;
    createRoot(() => {
      const outer = Loading(() => {
        outerOwner = getOwner()!;
        // A revealed inner Loading whose tree mounts the fresh computation.
        const inner = Loading(() => {
          innerOwner = getOwner()!;
          if (!open()) return "closed";
          const m = createMemo(() => `fresh ${x()}`);
          return m();
        }, "inner fallback");
        createRenderEffect(inner, v => {
          log.push(`inner ${v}`);
        });
        // A sibling still loading: the outer one has not shown content.
        const gate = createMemo(() => new Promise<string>(r => (resolveGate = () => r("gate"))));
        createRenderEffect(gate, v => {
          log.push(`gate ${v}`);
        });
        return "outer";
      }, "outer fallback");
      createRenderEffect(outer, v => {
        log.push(`outer ${v}`);
      });
    });
    flush();
    const release = hold(() => setX(1));
    const state = () => ({
      log: [...log],
      outerReaders: readersOf(outerOwner),
      innerReaders: readersOf(innerOwner)
    });
    const trace: unknown[] = [state()];
    setOpen(true);
    flush();
    trace.push(state());
    release();
    await tick();
    trace.push(state());
    resolveGate();
    await tick();
    trace.push(state());
    // The outer boundary only ever waits on the gate; the revealed inner one
    // records nothing.
    const waiting = {
      log: ["inner closed", "outer outer fallback"],
      outerReaders: 1,
      innerReaders: 0
    };
    expect(trace).toEqual([
      waiting,
      waiting,
      waiting,
      {
        log: ["inner closed", "outer outer fallback", "gate gate", "inner fresh 1", "outer outer"],
        outerReaders: 0,
        innerReaders: 0
      }
    ]);
  });
});

describe("#3540 and `on` (a dependency list, #3575): the first-pass catch adds nothing to what `on` does", () => {
  /** A revealed `<Loading on={...}>`; a transaction holding `x`; a Show in
   * its content mounts, in a flush, a fresh computation over `x`. `rearm`:
   * the Show's own signal is in `on`, so the mounting flush re-arms it. */
  function trace(rearm: boolean) {
    const [x, setX] = createSignal(0);
    const [open, setOpen] = createSignal(false);
    const log: string[] = [];
    let owner!: object;
    createRoot(() => {
      createRenderEffect(x, v => {
        log.push(`x ${v}`);
      });
      const view = untrack(() =>
        createLoadingBoundary(
          () => {
            owner = getOwner()!;
            createRenderEffect(
              () => {
                if (!open()) return false;
                const m = createMemo(() => `fresh ${x()}`);
                createRenderEffect(m, v => {
                  log.push(`text ${v}`);
                });
                return true;
              },
              v => {
                log.push(`open ${v}`);
              }
            );
            return "content";
          },
          () => "fallback",
          { on: () => (rearm ? open() : undefined) }
        )
      );
      createRenderEffect(view, v => {
        log.push(`view ${v}`);
      });
    });
    flush();
    const release = hold(() => setX(1));
    log.length = 0;
    const state = () => ({ log: [...log], readers: readersOf(owner) });
    return { release, setOpen, state };
  }

  for (const rearm of [false, true])
    it(`revealed, ${rearm ? "re-armed by" : "not re-armed by"} the mounting flush: not caught — the mount joins the transaction, as on next`, async () => {
      const s = trace(rearm);
      s.setOpen(true);
      flush();
      const steps: unknown[] = [s.state()];
      s.release();
      await tick();
      steps.push(s.state());
      expect(steps).toEqual([
        { log: [], readers: 0 },
        { log: ["text fresh 1", "x 1", "open true"], readers: 0 }
      ]);
    });

  for (const rearm of [false, true])
    it(`revealed, its tree mounting in the flush that ${rearm ? "re-arms" : "does not re-arm"} it: not caught, as on next`, async () => {
      const [x, setX] = createSignal(0);
      const [open, setOpen] = createSignal(false);
      const log: string[] = [];
      let owner!: object;
      createRoot(() => {
        createRenderEffect(x, v => {
          log.push(`x ${v}`);
        });
        const view = untrack(() =>
          createLoadingBoundary(
            () => {
              owner = getOwner()!;
              if (!open()) return "closed";
              return createMemo(() => `fresh ${x()}`)();
            },
            () => "fallback",
            { on: () => (rearm ? open() : undefined) }
          )
        );
        createRenderEffect(view, v => {
          log.push(`view ${v}`);
        });
      });
      flush();
      const release = hold(() => setX(1));
      log.length = 0;
      setOpen(true);
      flush();
      const steps: unknown[] = [{ log: [...log], readers: readersOf(owner) }];
      release();
      await tick();
      steps.push({ log: [...log], readers: readersOf(owner) });
      expect(steps).toEqual([
        { log: [], readers: 0 },
        { log: ["x 1", "view fresh 1"], readers: 0 }
      ]);
    });

  for (const inFlush of [true, false])
    it(`not yet revealed, mounted ${inFlush ? "in a flush" : "from mainline"} over the held value: the fallback now, the content at the commit, as a Loading without \`on\``, async () => {
      const [x, setX] = createSignal(0);
      const [open, setOpen] = createSignal(!inFlush);
      const [key] = createSignal(0);
      const release = hold(() => setX(1));
      const log: string[] = [];
      createRoot(() =>
        createRenderEffect(
          () => {
            if (!open()) return false;
            const view = untrack(() =>
              createLoadingBoundary(
                () => `content ${x()}`,
                () => "fallback",
                { on: key }
              )
            );
            createRenderEffect(view, v => {
              log.push(`view ${v}`);
            });
            return true;
          },
          v => {
            log.push(`open ${v}`);
          }
        )
      );
      flush();
      if (inFlush) {
        log.length = 0;
        setOpen(true);
        flush();
      }
      expect(log).toEqual(["view fallback", "open true"]);
      release();
      await tick();
      expect(log).toEqual(["view fallback", "open true", "view content 1"]);
    });
});
