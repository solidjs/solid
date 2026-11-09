/**
 * #4648: a non-keyed `<Show>` whose condition is staged this flush (an async
 * `when` that just landed) mounts its function child. A binding in that child
 * reads the narrowed accessor inside an `isPending()` thunk. The branch is on
 * screen, so the accessor must not read as stale there (#3948's guard): it
 * serves the value and the thunk's later reads link, so the verdict flips
 * while an update to them is in flight (D-23, F-9).
 */
import { afterEach, expect, test, vi } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  Match,
  resetErrorHalt,
  Show,
  Switch
} from "../src/index.js";

afterEach(() => {
  resetErrorHalt();
  vi.restoreAllMocks();
});

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Kind = "Show" | "Switch";

function setup(kind: Kind) {
  const [q, setQ] = createSignal(0);
  const resolvers: ((v: number) => void)[] = [];
  const screen: Record<string, unknown> = {};
  let disposeRoot!: () => void;
  createRoot(dispose => {
    disposeRoot = dispose;
    const job = createMemo(() => Promise.resolve({ id: 2 }));
    const child = (j: () => { id: number }) => {
      const rows = createMemo(() => {
        const x = q();
        return x === 0 ? 0 : new Promise<number>(r => resolvers.push(r));
      });
      createRenderEffect(
        () => {
          let guard = "none";
          const pending = isPending(() => {
            try {
              j();
            } catch {
              guard = "GUARD";
            }
            return q();
          });
          return `${guard}:${pending}`;
        },
        t => void (screen.probe = t)
      );
      createRenderEffect(
        () => rows(),
        v => void (screen.rows = v)
      );
      return "branch";
    };
    const view =
      kind === "Show"
        ? Show({
            get when() {
              return job();
            },
            children: child
          } as any)
        : Switch({
            get children() {
              return Match({
                get when() {
                  return job();
                },
                children: child
              } as any) as any;
            }
          });
    createRenderEffect(
      createLoadingBoundary(
        () => (view as any)(),
        () => "loading"
      ),
      v => void (screen.view = v)
    );
  });
  return { screen, resolvers, setQ, dispose: () => disposeRoot() };
}

for (const kind of ["Show", "Switch"] as const)
  test(`${kind}: a narrowed accessor read inside isPending() on a just-mounted branch is not stale`, async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { screen, resolvers, setQ, dispose } = setup(kind);
    flush();
    expect(screen.view).toBe("loading");
    await settle();
    expect(screen).toEqual({ view: "branch", probe: "none:false", rows: 0 });

    setQ(1); // held by rows' flight: q's update is pending
    flush();
    await settle();
    expect(screen).toEqual({ view: "branch", probe: "none:true", rows: 0 });

    resolvers.shift()!(1);
    await settle();
    expect(screen).toEqual({ view: "branch", probe: "none:false", rows: 1 });
    expect(error.mock.calls.map(c => String(c[0]).split("\n")[0])).toEqual([]);
    dispose();
  });

/**
 * The live-accessor skip is a verdict window's (#4648), not every frame's.
 * A `when` whose opening is held — a shown Loading's memo re-asks on it —
 * mounts the branch in the held world while the screen keeps the fallback.
 * A plain read of the narrowed accessor during the hold (a timer, an async
 * callback) sees the committed falsy: it throws the stale error rather than
 * hand out a value its type rules out, and serves the value once the hold
 * lands.
 */
function heldOpen(kind: Kind, initial: { id: number } | boolean, next: { id: number } | boolean) {
  const [open, setOpen] = createSignal<{ id: number } | boolean>(initial);
  const resolvers: (() => void)[] = [];
  const accs: (() => unknown)[] = [];
  const screen: Record<string, unknown> = {};
  let disposeRoot!: () => void;
  createRoot(dispose => {
    disposeRoot = dispose;
    const data = createMemo(() => {
      const o = open();
      return new Promise<string>(r => resolvers.push(() => r("d" + JSON.stringify(o))));
    });
    const child = (j: () => unknown) => (accs.push(j), "branch");
    const view =
      kind === "Show"
        ? Show({
            get when() {
              return open();
            },
            fallback: "closed",
            children: child
          } as any)
        : Switch({
            fallback: "closed",
            get children() {
              return Match({
                get when() {
                  return open();
                },
                children: child
              } as any) as any;
            }
          });
    createRenderEffect(
      () => (view as any)(),
      v => void (screen.view = v)
    );
    createRenderEffect(
      createLoadingBoundary(
        () => data(),
        () => "wait"
      ),
      v => void (screen.data = v)
    );
  });
  return {
    screen,
    accs,
    resolvers,
    setOpen: () => setOpen(next),
    setClosed: () => setOpen(false),
    dispose: () => disposeRoot()
  };
}

const read = (a: () => unknown) => {
  try {
    return JSON.stringify(a());
  } catch (e) {
    return String((e as Error)?.message ?? e).includes("stale value") ? "STALE" : String(e);
  }
};
const probe = (a: () => unknown) => {
  let inner = "";
  isPending(() => void (inner = read(a)));
  return inner;
};

for (const kind of ["Show", "Switch"] as const)
  test(`${kind}: a plain read of a narrowed accessor whose opening is held throws`, async () => {
    const { screen, accs, resolvers, setOpen, dispose } = heldOpen(kind, false, { id: 5 });
    flush();
    resolvers.shift()!();
    await settle();
    expect(screen).toEqual({ view: "closed", data: "dfalse" });

    setOpen(); // held: the Loading's memo re-asks on `open`
    flush();
    expect(screen).toEqual({ view: "closed", data: "dfalse" });
    expect(accs.length).toBe(1);
    expect(read(accs[0])).toBe("STALE");
    await new Promise(r => setTimeout(r, 0));
    expect(read(accs[0])).toBe("STALE"); // an async callback, as on `next`

    resolvers.shift()!();
    await settle();
    expect(screen).toEqual({ view: "branch", data: 'd{"id":5}' });
    expect(read(accs[0])).toBe('{"id":5}');
    dispose();
  });

/**
 * The run token is a fresh object, not the condition's value: an accessor
 * from an earlier run whose condition was equal (`true` → `false` → `true`)
 * is not the live run's, and inside a probe during the held reopen it still
 * reads as stale (its branch unmounted at the close).
 */
test("Show: an earlier run's accessor with an equal condition stays stale inside a probe", async () => {
  const { screen, accs, resolvers, setOpen, setClosed, dispose } = heldOpen("Show", true, true);
  flush();
  resolvers.shift()!();
  await settle();
  expect(screen).toEqual({ view: "branch", data: "dtrue" });

  setClosed();
  flush();
  resolvers.shift()!();
  await settle();
  expect(screen).toEqual({ view: "closed", data: "dfalse" });

  setOpen();
  flush();
  expect(accs.length).toBe(2);
  expect(probe(accs[0])).toBe("STALE");
  expect(read(accs[1])).toBe("STALE");

  resolvers.shift()!();
  await settle();
  expect(screen).toEqual({ view: "branch", data: "dtrue" });
  expect(read(accs[1])).toBe("true");
  dispose();
});
