/**
 * Creation during a foreign hold (A29's creation-time form, 2026-10-05).
 *
 * - #3802: a render effect born held inside a mount whose flush joined the
 *   hold has no committed value; a mainline write to another of its
 *   dependencies re-stages it and owes no run — its first run is the
 *   commit's.
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

describe("#3802: a born-held render effect re-derived by a mainline write", () => {
  it("re-stages and owes no run; the commit's first run shows the latest pass", async () => {
    const [value, setValue] = createSignal(false);
    const [mounted, setMounted] = createSignal(false);
    const [title, setTitle] = createSignal("");
    const log: string[] = [];
    createRoot(() => {
      // <Show when={mounted()}>{() => { createMemo(value); return <div …/> }}</Show>
      createRenderEffect(
        () => {
          if (!mounted()) return "none";
          createMemo(() => value());
          createRenderEffect(
            () => ({ cls: value(), title: title() }),
            ({ cls, title }) => {
              log.push(`div ${cls} ${title}`);
            }
          );
          return "child";
        },
        v => {
          log.push(`show ${v}`);
        }
      );
    });
    flush();
    const release = hold(() => setValue(true));
    log.length = 0;

    // In a flush: the mount's memo reads the held value, the flush joins the
    // hold, and the whole mount is born held with it (the tick is the frame).
    setMounted(true);
    flush();
    expect(log).toEqual([]);

    // A mainline write to the div's other dependency: no run before the
    // commit (the run would apply a value the effect never committed).
    setTitle("Updated");
    expect(() => flush()).not.toThrow();
    expect(log).toEqual([]);

    release();
    await tick();
    expect(log.sort()).toEqual(["div true Updated", "show child"]);
  });
});

describe("#3540 in a flush: a fresh Loading mounted over a held value shows its fallback now", () => {
  /** `<Loading fallback={fallback}>{fn()}</Loading>`, created untracked as
   * createComponent does. */
  const Loading = <T>(fn: () => T, fallback: string) =>
    untrack(() => createLoadingBoundary(fn, () => fallback));

  function setup(content: "memo" | "direct" | "bound") {
    const [x, setX] = createSignal(0);
    const [open, setOpen] = createSignal(false);
    const log: string[] = [];
    createRoot(() => {
      createRenderEffect(x, v => {
        log.push(`x ${v}`);
      });
      // <Show when={open()}><Loading fallback="fallback"><Content/></Loading></Show>
      createRenderEffect(
        () => {
          if (!open()) return false;
          const view = Loading(() => {
            if (content === "direct") return `content ${x()}`;
            const m = createMemo(() => `content ${x()}`);
            if (content === "memo") return m();
            // <p>{m()}</p>: the content's binding reads the memo, the tree does not.
            createRenderEffect(m, v => {
              log.push(`text ${v}`);
            });
            return "p";
          }, "fallback");
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
    const release = hold(() => setX(1));
    log.length = 0;
    return { setOpen, log, release };
  }

  for (const content of ["memo", "direct"] as const)
    it(`content reads the held value ${content === "memo" ? "through a memo" : "directly"}: the mount publishes, the content reveals at the commit`, async () => {
      const s = setup(content);
      s.setOpen(true);
      flush();
      expect(s.log).toEqual(["view fallback", "open true"]);

      s.release();
      await tick();
      expect(s.log).toEqual(["view fallback", "open true", "x 1", "view content 1"]);
    });

  it("content bound by a render effect under the boundary: the fallback until the commit", async () => {
    const s = setup("bound");
    s.setOpen(true);
    flush();
    expect(s.log).toEqual(["view fallback", "open true"]);

    s.release();
    await tick();
    expect(s.log.slice(2).sort()).toEqual(["text content 1", "view p", "x 1"]);
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
});

describe("#3800: a node created over a hold waits for it; the hold never waits for the node", () => {
  // `slow` holds count = 2 while its flight is out; `parent` shows both.
  function setup() {
    const [count, setCount] = createSignal(1);
    const slowGates: Array<() => void> = [];
    const log: string[] = [];
    createRoot(() => {
      const slow = createMemo(async () => {
        const c = count();
        await new Promise<void>(resolve => slowGates.push(resolve));
        return c;
      });
      createRenderEffect(
        () => [count(), slow()] as const,
        ([c, s]) => {
          log.push(`parent ${c} ${s}`);
        },
        undefined,
        { schedule: true }
      );
    });
    flush();
    return { count, setCount, slowGates, log };
  }

  async function holdCount(s: ReturnType<typeof setup>) {
    s.slowGates.shift()!();
    await tick();
    s.setCount(2);
    flush();
    expect(s.log).toEqual(["parent 1 1"]);
  }

  it("a first load that reads the held value lands into the hold (the report)", async () => {
    const s = setup();
    await holdCount(s);
    createRoot(() => {
      const child = createMemo(() => Promise.resolve(s.count()));
      createRenderEffect(
        child,
        v => {
          s.log.push(`child ${v}`);
        },
        undefined,
        { schedule: true }
      );
    });
    flush();
    await tick();
    expect(s.log).toEqual(["parent 1 1"]);

    s.slowGates.shift()!();
    await tick();
    expect(s.log).toEqual(["parent 1 1", "parent 2 2", "child 2"]);
  });

  it("under a fresh boundary: the fallback shows until the hold commits the content", async () => {
    const s = setup();
    await holdCount(s);
    createRoot(() => {
      const child = createMemo(() => Promise.resolve(s.count()));
      const view = createLoadingBoundary(
        () => `content ${child()}`,
        () => "fallback"
      );
      createRenderEffect(
        view,
        v => {
          s.log.push(`view ${v}`);
        },
        undefined,
        { schedule: true }
      );
    });
    flush();
    await tick();
    expect(s.log).toEqual(["parent 1 1", "view fallback"]);

    s.slowGates.shift()!();
    await tick();
    expect(s.log).toEqual(["parent 1 1", "view fallback", "parent 2 2", "view content 2"]);
  });

  it("the hold commits without a slower first load; the load lands after as its own commit", async () => {
    const s = setup();
    await holdCount(s);
    const childGates: Array<() => void> = [];
    createRoot(() => {
      const child = createMemo(async () => {
        const c = s.count();
        await new Promise<void>(resolve => childGates.push(resolve));
        return c;
      });
      createRenderEffect(
        child,
        v => {
          s.log.push(`child ${v}`);
        },
        undefined,
        { schedule: true }
      );
    });
    flush();

    s.slowGates.shift()!();
    await tick();
    expect(s.log).toEqual(["parent 1 1", "parent 2 2"]);

    childGates.shift()!();
    await tick();
    expect(s.log).toEqual(["parent 1 1", "parent 2 2", "child 2"]);
  });

  it("an action's hold: the first load waits for the action, never the reverse", async () => {
    const [user, setUser] = createSignal("ann");
    const log: string[] = [];
    createRoot(() => {
      createRenderEffect(user, u => {
        log.push(`header ${u}`);
      });
    });
    flush();
    const release = hold(() => setUser("bob"));

    const pageGates: Array<() => void> = [];
    const mount = (name: string) =>
      createRoot(() => {
        const page = createMemo(async () => {
          const u = user();
          await new Promise<void>(resolve => pageGates.push(resolve));
          return `${name}-${u}`;
        });
        createRenderEffect(page, v => {
          log.push(`page ${v}`);
        });
      });
    mount("fast");
    flush();
    mount("slow");
    flush();

    pageGates.shift()!();
    await tick();
    expect(log).toEqual(["header ann"]);

    release();
    await tick();
    expect(log).toEqual(["header ann", "header bob", "page fast-bob"]);

    pageGates.shift()!();
    await tick();
    expect(log).toEqual(["header ann", "header bob", "page fast-bob", "page slow-bob"]);
  });
});
