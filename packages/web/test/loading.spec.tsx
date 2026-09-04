/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import {
  lazy,
  type Component,
  createOptimisticStore,
  createSignal,
  createMemo,
  createStore,
  For,
  Loading,
  Errored,
  Show,
  Switch,
  Match,
  isPending,
  latest,
  flush
} from "solid-js";
import { render } from "../src/index.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
describe("Testing Basics", () => {
  test("Children are reactive", () => {
    let div = document.createElement("div");
    let increment: () => void;
    const disposer = render(() => {
      const [count, setCount] = createSignal(0);
      increment = () => setCount(count() + 1);
      return <Loading>{count()}</Loading>;
    }, div);
    expect(div.innerHTML).toBe("0");
    increment!();
    flush();
    expect(div.innerHTML).toBe("1");
    disposer();
  });

  test("isPending lets top-level initial async hold render", async () => {
    const localDiv = document.createElement("div");
    let resolveData!: (value: string) => void;

    const disposer = render(() => {
      const data = createMemo(() => new Promise<string>(r => (resolveData = r)));
      return <button disabled={isPending(data)}>{data()}</button>;
    }, localDiv);

    expect(localDiv.innerHTML).toBe("");

    resolveData("Ready");
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(localDiv.innerHTML).toBe("<button>Ready</button>");
    disposer();
  });
});

describe("Testing Loading", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    resolvers: Function[] = [],
    [triggered, trigger] = createSignal<string>();
  const LazyComponent = lazy<typeof ChildComponent>(() => new Promise(r => resolvers.push(r))),
    ChildComponent = (props: { greeting: string }) => {
      const value = createMemo(
        () => (
          triggered(),
          new Promise(r =>
            setTimeout(() => {
              r("Jo");
            }, 300)
          )
        )
      );

      return (
        <>
          {props.greeting} {value()}
        </>
      );
    },
    Component = () => (
      <Loading fallback="Loading">
        <LazyComponent greeting="Hi," />.
        <LazyComponent greeting="Hello" />
      </Loading>
    );

  test("Create Loading control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("Loading");
  });

  test("Toggle Loading control flow", async () => {
    for (const r of resolvers) r({ default: ChildComponent });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    vi.runAllTimers();
    await Promise.resolve();
    flush();

    expect(div.innerHTML).toBe("Hi, Jo.Hello Jo");
  });

  test("disposing the first in-flight lazy instance doesn't strand survivors (#2915)", async () => {
    const localDiv = document.createElement("div");
    let resolveModule!: (mod: { default: Component<{ tag: string }> }) => void;
    let importCalls = 0;

    const LazyComponent = lazy<Component<{ tag: string }>>(() => {
      importCalls++;
      return new Promise(resolve => {
        resolveModule = resolve;
      });
    });

    const [showFirst, setShowFirst] = createSignal(true);
    const localDispose = render(
      () => (
        <Loading fallback="loading">
          <Show when={showFirst()}>
            <LazyComponent tag="first" />
          </Show>
          <LazyComponent tag="second" />
        </Loading>
      ),
      localDiv
    );
    flush();
    expect(localDiv.innerHTML).toBe("loading");

    // Dispose the instance that initiated the shared import while in flight.
    setShowFirst(false);
    flush();

    resolveModule({ default: props => <b>{props.tag}</b> });
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(localDiv.innerHTML).toBe("<b>second</b>");
    expect(importCalls).toBe(1);

    // A late instance mounts synchronously from the resolved module.
    setShowFirst(true);
    flush();
    expect(localDiv.innerHTML).toBe("<b>first</b><b>second</b>");
    expect(importCalls).toBe(1);

    localDispose();
  });

  test("failed import is not cached — Errored reset() retries the download (#2999)", async () => {
    const localDiv = document.createElement("div");
    let importCalls = 0;
    let fail = true;

    const LazyComponent = lazy<Component<{}>>(() => {
      importCalls++;
      return fail
        ? Promise.reject(new Error("download failed"))
        : Promise.resolve({ default: () => <b>loaded</b> });
    });

    let doReset!: () => void;
    const localDispose = render(
      () => (
        <Errored
          fallback={(err, reset) => {
            doReset = reset;
            return String(err());
          }}
        >
          <Loading fallback="loading">
            <LazyComponent />
          </Loading>
        </Errored>
      ),
      localDiv
    );
    flush();
    expect(localDiv.innerHTML).toBe("loading");

    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe("Error: download failed");
    expect(importCalls).toBe(1);

    // The transient failure clears; reset() remounts and must re-import
    // instead of re-throwing the sealed-in rejection.
    fail = false;
    doReset();
    flush();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe("<b>loaded</b>");
    expect(importCalls).toBe(2);

    localDispose();
  });

  test("preload() retries after a failed import (#2999)", async () => {
    let importCalls = 0;
    let fail = true;

    const LazyComponent = lazy<Component<{}>>(() => {
      importCalls++;
      return fail
        ? Promise.reject(new Error("preload failed"))
        : Promise.resolve({ default: () => <i>ok</i> });
    });

    await expect(LazyComponent.preload()).rejects.toThrow("preload failed");
    fail = false;
    await LazyComponent.preload();
    expect(importCalls).toBe(2);
    // A resolved module stays cached.
    await LazyComponent.preload();
    expect(importCalls).toBe(2);
  });

  test("bare async memo as direct Loading child (issue #2677)", async () => {
    const localDiv = document.createElement("div");
    let resolveData!: (value: string) => void;

    const localDispose = render(() => {
      const data = createMemo(() => new Promise<string>(r => (resolveData = r)));
      return <Loading fallback="Loading...">{data()}</Loading>;
    }, localDiv);

    flush();
    expect(localDiv.innerHTML).toBe("Loading...");

    resolveData("Bare Data");
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe("Bare Data");

    localDispose();
  });

  async function expectRejectedRevalidation(localDiv: HTMLDivElement) {
    let increment!: () => void;
    const requests: Array<{ resolve: () => void }> = [];

    const localDispose = render(() => {
      const [count, setCount] = createSignal(0);
      increment = () => setCount(x => x + 1);
      const fetchedString = createMemo(async () => {
        const value = count();
        await new Promise<void>(resolve => requests.push({ resolve }));
        throw `Fetch error for ${value}`;
      });

      return (
        <div
          style={{
            opacity: isPending(count) ? 0.5 : 1
          }}
        >
          <span>{count()}</span>
          <Errored fallback={e => String(e())}>
            <Loading fallback="loading">
              <span>{fetchedString()}</span>
            </Loading>
          </Errored>
        </div>
      );
    }, localDiv);

    flush();
    expect(localDiv.firstElementChild!.getAttribute("style")).toBe("opacity: 1;");
    expect(localDiv.textContent).toBe("0loading");

    requests[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.firstElementChild!.getAttribute("style")).toBe("opacity: 1;");
    expect(localDiv.textContent).toBe("0Fetch error for 0");

    increment();
    flush();
    expect(localDiv.firstElementChild!.getAttribute("style")).toBe("opacity: 0.5;");
    expect(localDiv.textContent).toBe("0Fetch error for 0");

    requests[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.firstElementChild!.getAttribute("style")).toBe("opacity: 1;");
    expect(localDiv.textContent).toBe("1Fetch error for 1");

    localDispose();
  }

  test("isPending on an upstream signal clears after async rejection (issue #2700)", async () => {
    const localDiv = document.createElement("div");
    await expectRejectedRevalidation(localDiv);
  });

  test("Errored shows the latest async error after repeated rejections (issue #2701)", async () => {
    const localDiv = document.createElement("div");
    let increment!: () => void;
    const requests: Array<{ resolve: () => void }> = [];

    const localDispose = render(() => {
      const [count, setCount] = createSignal(0);
      increment = () => setCount(x => x + 1);
      const fetchedString = createMemo(async () => {
        const value = count();
        await new Promise<void>(resolve => requests.push({ resolve }));
        throw `Fetch error for ${value}`;
      });

      return (
        <div>
          <span>{count()}</span>
          <Errored fallback={e => String(e())}>
            <Loading fallback="loading">
              <span>{fetchedString()}</span>
            </Loading>
          </Errored>
        </div>
      );
    }, localDiv);

    flush();
    expect(localDiv.textContent).toBe("0loading");

    requests[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.textContent).toBe("0Fetch error for 0");

    increment();
    flush();
    expect(localDiv.textContent).toBe("0Fetch error for 0");

    requests[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.textContent).toBe("1Fetch error for 1");

    localDispose();
  });

  test("on prop treats component value as the boundary key", async () => {
    let setId!: (value: string) => void;
    const localDiv = document.createElement("div");
    let localDispose!: () => void;
    const resolvers: Record<string, (value: string) => void> = {};

    localDispose = render(() => {
      const [id, _setId] = createSignal("a");
      setId = _setId;
      const data = createMemo(async () => {
        const current = id();
        return await new Promise<string>(r => (resolvers[current] = r));
      });

      return Loading({
        fallback: "loading",
        get on() {
          return id();
        },
        get children() {
          return data();
        }
      }) as any;
    }, localDiv);

    flush();
    expect(localDiv.innerHTML).toBe("loading");

    resolvers.a("data-a");
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe("data-a");

    setId("b");
    flush();
    expect(localDiv.innerHTML).toBe("loading");

    resolvers.b("data-b");
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe("data-b");
    localDispose();
  });

  test("on prop keeps stale content when the keyed value is unchanged", async () => {
    let setId!: (value: string) => void;
    let setExtra!: (value: number) => void;
    const localDiv = document.createElement("div");
    let localDispose!: () => void;
    const resolvers: Record<string, (value: string) => void> = {};

    localDispose = render(() => {
      const [id, _setId] = createSignal("a");
      const [extra, _setExtra] = createSignal(0);
      setId = _setId;
      setExtra = _setExtra;
      const data = createMemo(async () => {
        const current = id();
        const next = extra();
        return await new Promise<string>(r => (resolvers[`${current}-${next}`] = r));
      });

      return Loading({
        fallback: "loading",
        get on() {
          return id();
        },
        get children() {
          return data();
        }
      }) as any;
    }, localDiv);

    flush();
    resolvers["a-0"]("data-a-0");
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe("data-a-0");

    setExtra(1);
    flush();
    expect(localDiv.innerHTML).toBe("data-a-0");

    resolvers["a-1"]("data-a-1");
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe("data-a-1");

    setId("b");
    flush();
    expect(localDiv.innerHTML).toBe("loading");

    resolvers["b-1"]("data-b-1");
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe("data-b-1");
    localDispose();
  });

  test("new keyed Loading boundary shows fallback for previously resolved async value while it refreshes", async () => {
    let setPage!: (value: "a" | "b") => void;
    const localDiv = document.createElement("div");
    let localDispose!: () => void;
    let current!: { promise: Promise<void>; resolve: () => void };

    const nextDeferred = () => {
      let resolve!: () => void;
      current = {
        promise: new Promise<void>(r => (resolve = r)),
        resolve
      };
    };

    nextDeferred();

    localDispose = render(() => {
      const [page, _setPage] = createSignal<"a" | "b">("a");
      setPage = _setPage;
      const source = createMemo(async () => {
        const value = page();
        await current.promise;
        return `value-${value}`;
      });

      return (
        <Show when={page()} keyed>
          {currentPage => (
            <Loading fallback="loading">{`Page ${currentPage}: ${source()}`}</Loading>
          )}
        </Show>
      );
    }, localDiv);

    flush();
    expect(localDiv.innerHTML).toBe("loading");

    current.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe("Page a: value-a");

    nextDeferred();
    setPage("b");
    flush();
    expect(localDiv.innerHTML).toBe("loading");

    current.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe("Page b: value-b");
    localDispose();
  });

  test("isPending falls back only for newly mounted attribute branches", async () => {
    let setPage!: (value: "a" | "b") => void;
    let setVersion!: (value: number) => void;
    const localDiv = document.createElement("div");
    let current!: { promise: Promise<void>; resolve: () => void };

    const nextDeferred = () => {
      let resolve!: () => void;
      current = {
        promise: new Promise<void>(r => (resolve = r)),
        resolve
      };
    };

    nextDeferred();

    const localDispose = render(() => {
      const [page, _setPage] = createSignal<"a" | "b">("a");
      const [version, _setVersion] = createSignal(0);
      setPage = _setPage;
      setVersion = _setVersion;
      const source = createMemo(async () => {
        const currentPage = page();
        const currentVersion = version();
        await current.promise;
        return `value-${currentPage}-${currentVersion}`;
      });

      return (
        <Show when={page()} keyed>
          {currentPage => (
            <Loading fallback={<button disabled>loading</button>}>
              <button disabled={isPending(source)}>
                Page {currentPage}: {source()}
              </button>
            </Loading>
          )}
        </Show>
      );
    }, localDiv);

    flush();
    expect(localDiv.firstElementChild!.textContent).toBe("loading");
    expect((localDiv.firstElementChild as HTMLButtonElement).disabled).toBe(true);

    current.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.firstElementChild!.textContent).toBe("Page a: value-a-0");
    expect((localDiv.firstElementChild as HTMLButtonElement).disabled).toBe(false);

    nextDeferred();
    setVersion(1);
    flush();
    expect(localDiv.firstElementChild!.textContent).toBe("Page a: value-a-0");
    expect((localDiv.firstElementChild as HTMLButtonElement).disabled).toBe(true);

    current.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.firstElementChild!.textContent).toBe("Page a: value-a-1");
    expect((localDiv.firstElementChild as HTMLButtonElement).disabled).toBe(false);

    nextDeferred();
    setPage("b");
    flush();
    expect(localDiv.firstElementChild!.textContent).toBe("loading");
    expect((localDiv.firstElementChild as HTMLButtonElement).disabled).toBe(true);

    current.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.firstElementChild!.textContent).toBe("Page b: value-b-1");
    expect((localDiv.firstElementChild as HTMLButtonElement).disabled).toBe(false);
    localDispose();
  });

  test("latest preserves sibling async text in Loading fragments", async () => {
    const localDiv = document.createElement("div");
    let setOg!: (value: number | ((prev: number) => number)) => number;
    let readDirect!: () => number;

    const localDispose = render(() => {
      const [og, _setOg] = createSignal(553);
      setOg = _setOg;
      const derived1 = createMemo(async () => {
        const o = og() + 1;
        await new Promise(res => setTimeout(res, 1000));
        return o;
      });
      const derived2 = createMemo(async () => {
        const o = derived1() + 1;
        await new Promise(res => setTimeout(res, 1000));
        return o;
      });
      readDirect = derived2;

      return (
        <Loading fallback="Loading...">
          a. {derived2()} b. {latest(derived2)}
        </Loading>
      );
    }, localDiv);

    flush();
    expect(localDiv.textContent).toBe("Loading...");

    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(localDiv.textContent).toBe("Loading...");

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    flush();
    expect(readDirect()).toBe(555);
    expect(localDiv.textContent).toBe("a. 555 b. 555");

    setOg(x => x + 1);
    flush();
    expect(localDiv.textContent).toBe("a. 555 b. 555");

    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(localDiv.textContent).toBe("a. 555 b. 555");

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    flush();
    expect(localDiv.textContent).toBe("a. 556 b. 556");

    localDispose();
  });

  test("implicit route transition stays held after lazy component is cached", async () => {
    let setRoute!: (value: "home" | "profile") => void;
    const localDiv = document.createElement("div");
    const resolvers: Array<(value: string) => void> = [];
    type ProfileProps = { user: string; info: string };
    let resolveLazy!: (mod: { default: Component<ProfileProps> }) => void;

    const nextData = () =>
      new Promise<string>(resolve => {
        resolvers.push(resolve);
      });
    const Profile: Component<ProfileProps> = props => {
      return (
        <>
          <h1>{props.user}'s Profile</h1>
          <p>{props.info}</p>
        </>
      );
    };
    const LazyProfile = lazy<Component<ProfileProps>>(
      () => new Promise(resolve => (resolveLazy = resolve))
    );
    const ProfileRoute = () => {
      const user = createMemo(() => nextData());
      const info = createMemo(() => {
        user();
        return nextData();
      });
      return <LazyProfile user={user()} info={info()} />;
    };

    const localDispose = render(() => {
      const [route, _setRoute] = createSignal<"home" | "profile">("home");
      setRoute = _setRoute;

      const matches = (value: "home" | "profile") => route() === value;

      return (
        <div class={{ pending: isPending(route) }}>
          <Switch>
            <Match when={matches("home")}>
              <h1>Home</h1>
            </Match>
            <Match when={matches("profile")}>
              <ProfileRoute />
            </Match>
          </Switch>
        </div>
      );
    }, localDiv);

    expect(localDiv.innerHTML).toBe("<div><h1>Home</h1></div>");

    setRoute("profile");
    flush();
    expect(localDiv.innerHTML).toBe('<div class="pending"><h1>Home</h1></div>');

    resolveLazy({ default: Profile });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe('<div class="pending"><h1>Home</h1></div>');

    resolvers.shift()!("Jon");
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe('<div class="pending"><h1>Home</h1></div>');

    resolvers.shift()!("Knows nothing");
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe(
      '<div class=""><h1>Jon\'s Profile</h1><p>Knows nothing</p></div>'
    );

    setRoute("home");
    flush();
    expect(localDiv.innerHTML).toBe('<div class=""><h1>Home</h1></div>');

    setRoute("profile");
    flush();
    expect(localDiv.innerHTML).toBe('<div class="pending"><h1>Home</h1></div>');

    resolvers.shift()!("Arya");
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe('<div class="pending"><h1>Home</h1></div>');

    resolvers.shift()!("No one");
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe('<div class=""><h1>Arya\'s Profile</h1><p>No one</p></div>');

    localDispose();
  });

  test("implicit route transition stays held through wrapped memo component output", async () => {
    let setRoute!: (value: "home" | "profile") => void;
    const localDiv = document.createElement("div");
    const resolvers: Array<(value: string) => void> = [];
    type ProfileProps = { user: string; info: string };

    const nextData = () =>
      new Promise<string>(resolve => {
        resolvers.push(resolve);
      });
    const Profile: Component<ProfileProps> = props => {
      return (
        <>
          <h1>{props.user}'s Profile</h1>
          <p>{props.info}</p>
        </>
      );
    };
    const WrappedProfile: Component<ProfileProps> = props =>
      createMemo(() => <Profile user={props.user} info={props.info} />, { sync: true }) as any;
    const ProfileRoute = () => {
      const user = createMemo(() => nextData());
      const info = createMemo(() => {
        user();
        return nextData();
      });
      return <WrappedProfile user={user()} info={info()} />;
    };

    const localDispose = render(() => {
      const [route, _setRoute] = createSignal<"home" | "profile">("home");
      setRoute = _setRoute;
      const matches = (value: "home" | "profile") => route() === value;

      return (
        <div class={{ pending: isPending(route) }}>
          <Switch>
            <Match when={matches("home")}>
              <h1>Home</h1>
            </Match>
            <Match when={matches("profile")}>
              <ProfileRoute />
            </Match>
          </Switch>
        </div>
      );
    }, localDiv);

    expect(localDiv.innerHTML).toBe("<div><h1>Home</h1></div>");

    setRoute("profile");
    flush();
    expect(localDiv.innerHTML).toBe('<div class="pending"><h1>Home</h1></div>');

    resolvers.shift()!("Jon");
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe('<div class="pending"><h1>Home</h1></div>');

    resolvers.shift()!("Knows nothing");
    await Promise.resolve();
    flush();
    expect(localDiv.innerHTML).toBe(
      '<div class=""><h1>Jon\'s Profile</h1><p>Knows nothing</p></div>'
    );

    localDispose();
  });

  test("dispose", () => {
    div.innerHTML = "";
    disposer();
  });
});

// An optimistic store's first flight must suspend into the nearest <Loading>
// like createStore(fn, seed) does. Its flight-owned transaction (#3146),
// declared for the uninitialized first ask too, held render()'s scheduled
// root insert until the fetch landed: the page stayed blank — not even
// content OUTSIDE the boundary mounted — and the fallback never showed.
describe("<Loading> around an optimistic store's first flight", () => {
  // Real timers: the fetches below settle on their own schedule.
  beforeEach(() => {
    vi.useRealTimers();
  });
  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  type Item = { id: number; label: string; votes: number };
  function poll(make: typeof createStore | typeof createOptimisticStore) {
    const [tick, setTick] = createSignal(0);
    let fetches = 0;
    const [list] = make<Item[]>(async () => {
      tick();
      const n = ++fetches;
      await wait(10);
      return [{ id: 1, label: "Tacos", votes: n - 1 }];
    }, [] as Item[]);
    return { list, setTick };
  }

  function mount(make: typeof createStore | typeof createOptimisticStore) {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const div = document.createElement("div");
    let setTick!: (v: number) => void;
    const dispose = render(() => {
      const p = poll(make);
      setTick = p.setTick;
      return (
        <>
          <h1>Poll</h1>
          <Loading fallback={<div>Loading...</div>}>
            <ul>
              <For each={p.list}>
                {item => (
                  <li>
                    {item.label} - {item.votes}
                  </li>
                )}
              </For>
            </ul>
          </Loading>
        </>
      );
    }, div);
    flush();
    // Comment markers from insert() are noise for these assertions.
    const html = () => div.innerHTML.replace(/<!---->/g, "");
    return {
      html,
      refetch: () => setTick(1),
      dispose: () => {
        dispose();
        warn.mockRestore();
      }
    };
  }

  test("createOptimisticStore(fn, seed) in the component body: fallback at mount, list after landing, content kept on refetch", async () => {
    const { html, dispose, refetch } = mount(createOptimisticStore);
    expect(html()).toBe("<h1>Poll</h1><div>Loading...</div>");

    await wait(30);
    flush();
    expect(html()).toBe("<h1>Poll</h1><ul><li>Tacos - 0</li></ul>");

    // Refetch: stale-while-revalidate — no fallback, then the new truth.
    refetch();
    flush();
    await wait(2);
    flush();
    expect(html()).toBe("<h1>Poll</h1><ul><li>Tacos - 0</li></ul>");
    await wait(30);
    flush();
    expect(html()).toBe("<h1>Poll</h1><ul><li>Tacos - 1</li></ul>");
    dispose();
  });

  test("control: createStore(fn, seed) in the same spot", async () => {
    const { html, dispose } = mount(createStore);
    expect(html()).toBe("<h1>Poll</h1><div>Loading...</div>");
    await wait(30);
    flush();
    expect(html()).toBe("<h1>Poll</h1><ul><li>Tacos - 0</li></ul>");
    dispose();
  });
});
