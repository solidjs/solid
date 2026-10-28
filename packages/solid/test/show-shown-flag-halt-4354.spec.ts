/**
 * #4354: `<Show when={open()}>{v => …}</Show>` beside a `<Loading>` over an
 * async memo that re-asks on `open`. A write to `open` is held by that memo's
 * flight, so the screen keeps the old branch while Show's selection has
 * already re-run in the held world. An unrelated write (`setFmt`) then re-runs
 * an on-screen binding. A binding is a frame reader: it reads what the screen
 * shows, so the narrowed accessor must not judge the branch stale from the
 * held selection — <Switch>/<Match> already behaves this way. A read after the
 * branch really unmounts still throws (#3948's guard).
 */
import { afterEach, expect, test, vi } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
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
    await Promise.resolve();
    flush();
  }
};

type Kind = "Show" | "Switch";

function setup(kind: Kind, keyed: boolean, initial: boolean) {
  const [open, setOpen] = createSignal(initial);
  const [fmt, setFmt] = createSignal("ru");
  const resolvers: (() => void)[] = [];
  const screen: Record<string, unknown> = {};
  let accessor: (() => string) | undefined;
  createRoot(() => {
    const data = createMemo(() => {
      const o = open();
      return new Promise<string>(r => resolvers.push(() => r(`data-${o}`)));
    });
    const when = () => open() && "sel";
    const child = (v: string | (() => string)) => {
      const read = typeof v === "function" ? ((accessor = v), v) : () => v;
      createRenderEffect(
        () => `${fmt()}:${read()}`,
        t => void (screen.p = t)
      );
      return "branch";
    };
    const fallback = () => {
      createRenderEffect(
        () => `${fmt()}:closed`,
        t => void (screen.f = t)
      );
      return "closed";
    };
    const view =
      kind === "Show"
        ? Show({
            get when() {
              return when();
            },
            keyed,
            get fallback() {
              return fallback();
            },
            children: child
          } as any)
        : Switch({
            get fallback() {
              return fallback();
            },
            get children() {
              return Match({
                get when() {
                  return when();
                },
                keyed,
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
  return { screen, resolvers, setOpen, setFmt, accessor: () => accessor };
}

for (const kind of ["Show", "Switch"] as const)
  for (const keyed of [false, true]) {
    const name = `${kind}${keyed ? " keyed" : ""}`;

    test(`${name}: an on-screen branch re-run during the hold that closes it does not halt`, async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { screen, resolvers, setOpen, setFmt, accessor } = setup(kind, keyed, true);
      flush();
      resolvers.shift()!();
      await settle();
      expect(screen).toEqual({ view: "branch", p: "ru:sel", data: "data-true" });

      setOpen(false); // held by data's re-ask: the branch stays on screen
      flush();
      expect(screen).toMatchObject({ view: "branch", p: "ru:sel", data: "data-true" });

      setFmt("en"); // unrelated write re-runs the on-screen binding mid-hold
      flush();
      expect(screen).toMatchObject({ view: "branch", p: "en:sel", data: "data-true" });

      resolvers.shift()!();
      await settle();
      expect(screen).toEqual({ view: "closed", p: "en:sel", f: "en:closed", data: "data-false" });
      expect(error.mock.calls.map(c => String(c[0]).split("\n")[0])).toEqual([]);

      // After the close lands, a read of the narrowed accessor is a real
      // stale read and still throws.
      if (!keyed) expect(() => accessor()!()).toThrow(kind === "Show" ? /<Show>/ : /<Match>/);
    });

    test(`${name}: the fallback re-run during the hold that opens the branch does not halt`, async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { screen, resolvers, setOpen, setFmt } = setup(kind, keyed, false);
      flush();
      resolvers.shift()!();
      await settle();
      expect(screen).toEqual({ view: "closed", f: "ru:closed", data: "data-false" });

      setOpen(true); // held: the fallback stays on screen
      flush();
      expect(screen.view).toBe("closed");
      expect(screen.data).toBe("data-false");

      setFmt("en");
      flush();
      expect(screen.view).toBe("closed");
      expect(screen.f).toBe("en:closed");

      resolvers.shift()!();
      await settle();
      expect(screen.view).toBe("branch");
      expect(screen.p).toBe("en:sel");
      expect(screen.data).toBe("data-true");
      expect(error.mock.calls.map(c => String(c[0]).split("\n")[0])).toEqual([]);
    });
  }

test("Show: a branch closed and reopened inside one hold keeps reading the screen", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const [open, setOpen] = createSignal<string | false>("a");
  const [fmt, setFmt] = createSignal("ru");
  const resolvers: (() => void)[] = [];
  const out: string[] = [];
  createRoot(() => {
    const data = createMemo(() => {
      const o = open();
      return new Promise<string>(r => resolvers.push(() => r(`data-${o}`)));
    });
    const view = Show({
      get when() {
        return open();
      },
      fallback: "closed",
      children: (v: () => string) => {
        createRenderEffect(
          () => `${fmt()}:${v()}`,
          t => void out.push(t)
        );
        return "branch";
      }
    });
    createRenderEffect(
      () => (view as any)(),
      () => {}
    );
    createRenderEffect(
      createLoadingBoundary(
        () => data(),
        () => "wait"
      ),
      () => {}
    );
  });
  flush();
  resolvers.shift()!();
  await settle();
  setOpen(false);
  flush();
  setFmt("en");
  flush();
  setOpen("b");
  flush();
  setFmt("fr");
  flush();
  expect(out).toEqual(["ru:a", "en:a", "fr:a"]);
  while (resolvers.length) resolvers.shift()!();
  await settle();
  expect(out).toEqual(["ru:a", "en:a", "fr:a", "fr:b"]);
  expect(error.mock.calls.map(c => String(c[0]).split("\n")[0])).toEqual([]);
});
