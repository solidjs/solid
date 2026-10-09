/**
 * #3948: a non-keyed `<Show when={latest(async)}>` selects its branch from the
 * display-ahead value, then the narrowed accessor re-reads that condition.
 * The guard must use the same view and must not stamp the caller (the text
 * binding) as a verdict reader. A real stale read — the branch is no longer
 * the selected one — still throws.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createLoadingBoundary,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  Match,
  resetErrorHalt,
  Show,
  Switch
} from "../src/index.js";

/**
 * `Show` / `Switch` return `JSX.Element`. Called as functions they are memos,
 * which the element union (numbers, booleans, nodes, null) does not reflect.
 */
function mount(view: unknown): unknown {
  return (view as () => unknown)();
}

afterEach(() => {
  resetErrorHalt();
  vi.restoreAllMocks();
});

async function settle() {
  await new Promise(r => setTimeout(r, 0));
  flush();
}

describe("non-keyed Show when={latest(async)} (#3948)", () => {
  test("renders the arrived value on first mount without halting", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let screen = "";
    let ticks = 0;
    let dispose!: () => void;
    const [tick, setTick] = createSignal(0);

    createRoot(d => {
      dispose = d;
      const [identity] = createSignal(async () => "Bob");
      const show = Show({
        get when() {
          return latest(identity);
        },
        children: (name: () => string) => {
          createRenderEffect(
            () => name(),
            v => {
              screen = `Signed in as ${v}`;
            }
          );
          return "open";
        }
      });
      const boundary = createLoadingBoundary(
        () => mount(show),
        () => "loading"
      );
      createRenderEffect(
        () => boundary(),
        () => {}
      );
      createRenderEffect(
        () => tick(),
        v => {
          ticks = v;
        }
      );
    });

    flush();
    await settle();
    await settle();

    expect(screen).toBe("Signed in as Bob");
    expect(error.mock.calls.some(args => /REACTIVITY_HALTED/.test(String(args[0])))).toBe(false);

    setTick(1);
    flush();
    expect(ticks).toBe(1);
    dispose();
  });

  test("a genuine stale read still throws", () => {
    let accessor!: () => string;
    let dispose!: () => void;
    const [name, setName] = createSignal<string | false>("Bob");

    createRoot(d => {
      dispose = d;
      const view = Show({
        get when() {
          return name();
        },
        children: (value: () => string) => {
          accessor = value;
          return "open";
        }
      });
      createRenderEffect(
        () => mount(view),
        () => {}
      );
    });
    flush();
    expect(accessor()).toBe("Bob");

    setName(false);
    flush();
    expect(() => accessor()).toThrow(/<Show>/);
    dispose();
  });
});

describe("non-keyed Match when={latest(async)} (#3948)", () => {
  test("renders the arrived value on first mount without halting", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let screen = "";
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const [identity] = createSignal(async () => "Bob");
      const view = Switch({
        get children() {
          return Match({
            get when() {
              return latest(identity);
            },
            children: (name: () => string) => {
              createRenderEffect(
                () => name(),
                v => {
                  screen = `Signed in as ${v}`;
                }
              );
              return "open";
            }
          });
        }
      });
      const boundary = createLoadingBoundary(
        () => (view as any)(),
        () => "loading"
      );
      createRenderEffect(
        () => boundary(),
        () => {}
      );
    });

    flush();
    await settle();
    await settle();

    expect(screen).toBe("Signed in as Bob");
    expect(error.mock.calls.some(args => /REACTIVITY_HALTED/.test(String(args[0])))).toBe(false);
    dispose();
  });

  test("a genuine stale read still throws", () => {
    let accessor!: () => string;
    let dispose!: () => void;
    const [name, setName] = createSignal<string | false>("Bob");

    createRoot(d => {
      dispose = d;
      const view = Switch({
        get children() {
          return Match({
            get when() {
              return name();
            },
            children: (value: () => string) => {
              accessor = value;
              return "open";
            }
          });
        }
      });
      createRenderEffect(
        () => (view as any)(),
        () => {}
      );
    });
    flush();
    expect(accessor()).toBe("Bob");

    setName(false);
    flush();
    expect(() => accessor()).toThrow(/<Match>/);
    dispose();
  });
});
