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
