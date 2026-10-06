/** Executes `mount-under-hold` cases (see mount-cases.ts) against the real runtime. */
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../../src/index.js";
import type { RunResult } from "./runner.js";
import type { Scenario } from "./scenario.js";
import {
  judge,
  unruled,
  validateMountCase,
  type Checkpoint,
  type MountCase,
  type MountSnapshot
} from "./mount-cases.js";

const settle = async () => {
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    flush();
    await new Promise<void>(r => setImmediate(r));
    flush();
  }
};

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  done: boolean;
}
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  const d: Deferred = { promise, done: false, resolve: () => ((d.done = true), resolve()) };
  return d;
};

/** `<Loading fallback={fallback} on={on}>{fn()}</Loading>`, created untracked
 * as createComponent does. The boundary's `children` computation runs `fn`;
 * an accessor it returns is read by the boundary's tree (`flatten`), so
 * content reading its own nodes never re-runs the code that created them. */
const Loading = <T>(fn: () => T, fallback: string, on?: () => unknown) =>
  untrack(() => createLoadingBoundary(fn, () => fallback, on ? { on } : undefined));

const resolve = (v: unknown): unknown => {
  while (typeof v === "function") v = (v as () => unknown)();
  return v;
};

export async function runMountCase(c: MountCase): Promise<RunResult> {
  const started = performance.now();
  const snapshots: MountSnapshot[] = [];
  const events: string[] = [];
  const result: RunResult = {
    status: "pass",
    scenario: c as unknown as Scenario,
    frames: [],
    requirements: [],
    work: [],
    coverage: [
      `mount:${c.family}`,
      `mount:hold:${c.hold}`,
      `mount:trigger:${c.trigger}`,
      `mount:show:${c.show}`,
      `mount:content:${c.content}`,
      ...(c.ownLoad ? ["mount:own-load"] : []),
      ...(c.lane ? [`mount:lane:${c.lane.reads}:${c.lane.wrap ? "wrap" : "direct"}`] : []),
      unruled(c) ? "mount:unruled" : "mount:ruled"
    ],
    events,
    metrics: { operations: 0, skipped: 0, requests: 0, frames: 0, elapsedMs: 0 }
  };
  const invalid = validateMountCase(c);
  if (invalid) {
    result.status = "invalid";
    result.error = invalid;
    return result;
  }
  const disposers: Array<() => void> = [];
  const releases: Array<() => void> = [];
  let ownGates: Deferred[] = [];
  const outerGate = deferred();
  const resolveOwn = async () => {
    for (let round = 0; round < 5 && ownGates.length; round++) {
      const gates = ownGates;
      ownGates = [];
      for (const g of gates) g.resolve();
      await settle();
    }
  };
  try {
    const V = c.value;
    // --- the held source -------------------------------------------------
    const [src, setSrc] = createSignal(0);
    const xGates: Array<{ value: number; gate: Deferred }> = [];
    const answer = (value: number) => {
      for (const g of xGates) if (g.value === value) g.gate.resolve();
    };
    const x: () => number =
      c.hold === "flight"
        ? createRoot(dispose => {
            disposers.push(dispose);
            return createMemo(() => {
              const v = src();
              const gate = deferred();
              xGates.push({ value: v, gate });
              result.metrics.requests++;
              return gate.promise.then(() => v);
            });
          })
        : src;

    // --- observation -----------------------------------------------------
    let screenX: number | undefined;
    const texts = new Map<number, string>();
    let bindings = 0;
    let running = false;
    /** What a slot shows, with each element replaced by its binding's text. */
    const render = (v: unknown): string => {
      if (v === undefined || v === false || v === null) return "closed";
      if (v === true) return "torn:control-without-content";
      return String(v).replace(/p#(\d+)/g, (_, id) => {
        const t = texts.get(Number(id));
        return t === undefined ? "torn:element-without-binding" : t;
      });
    };
    /** A render effect inserting `accessor` (a JSX insert). */
    const slotOf = (accessor: () => unknown) => {
      const slot: { v?: unknown } = {};
      createRenderEffect(accessor, v => {
        slot.v = v;
      });
      return slot;
    };
    let seen: () => string = () => "closed";

    const anchor = () =>
      createRoot(dispose => {
        disposers.push(dispose);
        createRenderEffect(x, v => {
          screenX = v;
        });
      });
    if (!c.anchorLast) anchor();

    // --- content ---------------------------------------------------------
    const own = (read: () => number) =>
      createMemo(() => {
        const v = read();
        const gate = deferred();
        ownGates.push(gate);
        result.metrics.requests++;
        return gate.promise.then(() => v);
      });
    /** A content component: its body runs untracked and returns what its
     * JSX would — an accessor (a memo, or a direct expression), or an
     * element whose text a render effect binds. */
    const component = (kind: "memo" | "direct" | "bound", read: () => number): unknown =>
      untrack(() => {
        const value = c.ownLoad ? own(read) : read;
        if (kind === "direct") return () => `content ${value()}`;
        const m = createMemo(() => `content ${value()}`);
        if (kind === "memo") return m;
        const id = ++bindings;
        createRenderEffect(m, v => {
          texts.set(id, v);
        });
        return `p#${id}`;
      });
    const leaf = (read: () => number) =>
      component(c.content === "nested" ? "memo" : c.content, read);
    /** A new boundary over the content (its output accessor). */
    const freshBoundary = (read: () => number) => {
      if (c.content === "nested")
        return Loading(() => {
          const inner = Loading(() => leaf(read), "fallback");
          return () => `[${resolve(inner())}]`;
        }, "outer fallback");
      const [key] = createSignal(0);
      return Loading(() => leaf(read), "fallback", c.keyed ? key : undefined);
    };

    /** `<Show when={cond()}>{mount()}</Show>` in the case's compiled form;
     * returns what its slot shows. */
    const show = (cond: () => boolean, mount: () => unknown): (() => string) => {
      if (c.show === "effect") {
        // A mounting render effect (the control); an accessor child gets its
        // own insert effect under it.
        const control: { open?: unknown; child?: { v?: unknown } } = {};
        createRenderEffect(
          () => {
            if (!cond()) return false;
            const child = untrack(mount);
            if (typeof child !== "function") return child;
            control.child = slotOf(() => resolve(child));
            return true;
          },
          v => {
            control.open = v;
          }
        );
        return () =>
          control.open !== true
            ? render(control.open)
            : control.child && "v" in control.child
              ? render(control.child.v)
              : render(true);
      }
      const condition = createMemo(() => !!cond());
      const children = createMemo(() => (condition() ? untrack(mount) : undefined));
      const slot = slotOf(() => resolve(children()));
      return () => render(slot.v);
    };

    // --- the mount site ----------------------------------------------------
    const [open, setOpen] = createSignal(false);
    const [key, setKey] = createSignal(0);
    let flip: () => void = () => setOpen(true);
    let mountRoot: (() => void) | undefined;
    let hold = () => {
      if (c.hold === "action") {
        const gate = deferred();
        releases.push(gate.resolve);
        action(function* () {
          setSrc(V);
          yield gate.promise;
        })();
      } else setSrc(V);
    };
    let release = () => {
      if (c.hold === "action") releases.shift()?.();
      else answer(V);
    };

    /** A revealed boundary's tree that mounts the content on `open`: the
     * condition in the tree itself (`memo`), or a Show inside it (`effect`).
     * `seen` maps the boundary's displayed value to what the screen shows. */
    const revealedTree = () => {
      if (c.show === "memo")
        return {
          fn: () => (open() ? leaf(x) : "closed"),
          seen: (v: unknown) => render(v)
        };
      let inner: () => string = () => "closed";
      return {
        fn: () => {
          inner = show(open, () => leaf(x));
          return "box";
        },
        seen: (v: unknown) => (v === "box" ? inner() : render(v))
      };
    };

    createRoot(dispose => {
      disposers.push(dispose);
      switch (c.family) {
        case "fresh":
          if (c.trigger === "root")
            mountRoot = () =>
              createRoot(d => {
                disposers.push(d);
                const slot = slotOf(freshBoundary(x));
                seen = () => render(slot.v);
              });
          else seen = show(open, () => freshBoundary(x));
          break;
        case "rearm-mount":
        case "revealed": {
          const on = c.family === "rearm-mount" ? open : c.keyed ? key : undefined;
          const tree = revealedTree();
          const slot = slotOf(Loading(tree.fn, "fallback", on));
          seen = () => tree.seen(slot.v);
          break;
        }
        case "rearm-committed": {
          const slot = slotOf(Loading(() => leaf(x), "fallback", key));
          seen = () => render(slot.v);
          flip = () => setKey(1);
          break;
        }
        case "none":
          seen = show(open, () => leaf(x));
          break;
        case "revealed-under-pending":
        case "revealed-under-rearmed": {
          let inner: () => string = () => "closed";
          const outer = slotOf(
            Loading(
              () => {
                const tree = revealedTree();
                const slot = slotOf(Loading(tree.fn, "fallback"));
                inner = () => tree.seen(slot.v);
                if (c.family === "revealed-under-pending")
                  slotOf(createMemo(() => outerGate.promise.then(() => "gate")));
                return "outer";
              },
              "outer fallback",
              c.family === "revealed-under-rearmed" ? open : undefined
            )
          );
          seen = () => (outer.v === "outer" ? inner() : render(outer.v));
          break;
        }
        case "held-cond":
          seen = show(
            () => x() > 0,
            () => (c.boundary ? freshBoundary(x) : leaf(x))
          );
          break;
        case "verdict":
          seen = show(
            () => latest(x) > 0,
            () => freshBoundary(x)
          );
          break;
        case "lane": {
          // #3835's shape: an action holds the source and guesses the
          // optimistic view of it; the guess mounts an element whose binding
          // reads the held source, the guess, or a memo of the held source.
          const [visible, setVisible] = createOptimistic(() => src());
          const view = () => {
            const id = ++bindings;
            const read =
              c.lane!.reads === "held"
                ? src
                : c.lane!.reads === "guess"
                  ? visible
                  : createMemo(() => src());
            createRenderEffect(
              () => `content ${read()}`,
              v => {
                texts.set(id, v);
              }
            );
            return `p#${id}`;
          };
          seen = show(
            () => visible() > 0,
            () => (c.lane!.wrap ? createMemo(view) : view())
          );
          hold = () => {
            const gate = deferred();
            releases.push(gate.resolve);
            running = true;
            action(function* () {
              setSrc(V);
              setVisible(V);
              yield gate.promise;
            })().then(() => (running = false));
          };
          release = () => releases.shift()?.();
          break;
        }
      }
    });
    if (c.anchorLast) anchor();
    flush();
    // Initial loads: the flight's first answer and any committed content's.
    answer(0);
    await settle();
    await resolveOwn();

    const snap = (at: Checkpoint) => {
      const s: MountSnapshot = { at, x: screenX, seen: seen(), running };
      snapshots.push(s);
      events.push(`${at} x=${s.x} seen=${s.seen}${running ? " running" : ""}`);
      result.metrics.frames++;
    };
    snap("S0");
    if (c.trigger === "same-tick") {
      hold();
      flip();
      result.metrics.operations += 2;
      flush();
      await settle();
      snap("S1");
      snap("S2");
    } else {
      hold();
      result.metrics.operations++;
      flush();
      await settle();
      snap("S1");
      if (c.trigger === "flip") flip();
      else if (c.trigger === "root") mountRoot!();
      if (c.trigger !== "hold") {
        result.metrics.operations++;
        flush();
      }
      await settle();
      snap("S2");
    }
    release();
    result.metrics.operations++;
    await settle();
    snap("S3");
    outerGate.resolve();
    await settle();
    await resolveOwn();
    snap("S4");
    judge(c, snapshots, result);
  } catch (error) {
    result.status = "error";
    result.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    for (const r of releases) r();
    for (const g of ownGates) g.resolve();
    outerGate.resolve();
    try {
      await settle();
      for (const d of disposers.reverse()) d();
      flush();
    } catch (error) {
      result.cleanupError = String(error);
    }
    result.metrics.elapsedMs = performance.now() - started;
    (result as RunResult & { snapshots?: MountSnapshot[] }).snapshots = snapshots;
  }
  return result;
}
