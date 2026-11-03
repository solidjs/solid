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
