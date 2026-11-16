/** @jsxImportSource solid-js */
/** @vitest-environment jsdom */
import {
  createRoot,
  createSignal,
  For,
  Index,
  indexArray,
  mapArray,
  onCleanup,
  createContext,
  useContext,
  getOwner,
  createComputed,
  ErrorBoundary
} from "solid-js";
import { render } from "solid-js/web";
import { createStore, produce } from "../../store/src/index.js";
import { expect, test } from "vitest";

for (const List of [For, Index]) {
  test(`${List.name} retains a fallback editor until the empty branch ends`, () => {
    const [items, setItems] = createSignal<string[] | null | undefined | false>([]);
    const [label, setLabel] = createSignal("Draft");
    let mounts = 0,
      cleanups = 0;
    const Draft = () => {
      mounts++;
      const [draft, setDraft] = createSignal("untitled");
      onCleanup(() => cleanups++);
      return (
        <div>
          <label>{label()}</label>
          <input value={draft()} onInput={event => setDraft(event.currentTarget.value)} />
          <output>{draft()}</output>
        </div>
      );
    };
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(
      () => (
        <List each={items()} fallback={<Draft />}>
          {() => <span>saved item</span>}
        </List>
      ),
      container
    );
    try {
      const input = container.querySelector("input")!;
      input.value = "unfinished note";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(container.querySelector("output")!.textContent).toBe("unfinished note");
      const emptyLists: (string[] | null | undefined | false)[] = [[], null, undefined, false, []];
      for (const empty of emptyLists) {
        setItems(empty);
        expect(container.querySelector("input")).toBe(input);
        expect(container.querySelector("output")!.textContent).toBe("unfinished note");
        expect(mounts).toBe(1);
        expect(cleanups).toBe(0);
      }
      setLabel("Saved draft");
      expect(container.querySelector("label")!.textContent).toBe("Saved draft");
      expect(container.querySelector("input")).toBe(input);
      setItems(["saved item"]);
      expect(container.textContent).toBe("saved item");
      expect(cleanups).toBe(1);
      setItems([]);
      expect(container.querySelector("input")).not.toBe(input);
      expect(container.querySelector("output")!.textContent).toBe("untitled");
      expect(mounts).toBe(2);
      expect(cleanups).toBe(1);
      setItems([]);
      expect(mounts).toBe(2);
    } finally {
      dispose();
      container.remove();
    }
    expect(cleanups).toBe(2);
  });

  test.each([undefined, null, false, "", 0])(
    `${List.name} retains a fallback returning %s`,
    value => {
      const [items, setItems] = createSignal<string[]>([]);
      let mounts = 0,
        cleanups = 0;
      const Fallback = () => {
        mounts++;
        onCleanup(() => cleanups++);
        return value;
      };
      const container = document.createElement("div");
      const dispose = render(
        () => (
          <List each={items()} fallback={<Fallback />}>
            {() => <span>row</span>}
          </List>
        ),
        container
      );
      try {
        expect(container.textContent).toBe(value === 0 ? "0" : "");
        setItems([]);
        expect(mounts).toBe(1);
        expect(cleanups).toBe(0);
        setItems(["row"]);
        expect(container.textContent).toBe("row");
        expect(cleanups).toBe(1);
        setItems([]);
        expect(container.textContent).toBe(value === 0 ? "0" : "");
        expect(mounts).toBe(2);
        expect(cleanups).toBe(1);
      } finally {
        dispose();
      }
      expect(cleanups).toBe(2);
    }
  );
}

for (const map of [mapArray, indexArray]) {
  test(`${map.name} retries an unsuccessful fallback`, () => {
    createRoot(dispose => {
      let attempts = 0;
      const mapped = map(
        () => [],
        () => 0,
        {
          fallback: () => {
            if (++attempts === 1) throw new Error("try again");
            return 0;
          }
        }
      );
      try {
        expect(mapped).toThrow("try again");
        expect(mapped()).toEqual([0]);
        expect(attempts).toBe(2);
      } finally {
        dispose();
      }
    });
  });
}

for (const List of [For, Index]) {
  test(`${List.name} updates direct fallback expressions while retaining an unchanged branch`, () => {
    const [items, setItems] = createSignal<string[]>([]);
    const [label, setLabel] = createSignal("initial");
    const container = document.createElement("div");
    const dispose = render(
      () => (
        <List each={items()} fallback={label()}>
          {() => "row"}
        </List>
      ),
      container
    );
    try {
      expect(container.textContent).toBe("initial");
      setLabel("updated");
      expect(container.textContent).toBe("updated");
      setItems([]);
      expect(container.textContent).toBe("updated");
      setItems(["row"]);
      setLabel("next");
      expect(container.textContent).toBe("row");
      setItems([]);
      expect(container.textContent).toBe("next");
    } finally {
      dispose();
    }
  });

  test(`${List.name} retains a changed fallback editor until its actual dependency changes`, () => {
    const [items, setItems] = createSignal<string[]>([]);
    const [version, setVersion] = createSignal(false);
    const events: string[] = [];
    const Draft = (props: { name: string }) => {
      events.push(`mount:${props.name}`);
      const [draft, setDraft] = createSignal(props.name);
      onCleanup(() => events.push(`cleanup:${props.name}`));
      return (
        <>
          <input value={draft()} onInput={e => setDraft(e.currentTarget.value)} />
          <output>{draft()}</output>
        </>
      );
    };
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(
      () => (
        <List
          each={items()}
          fallback={version() ? <Draft name="second" /> : <Draft name="first" />}
        >
          {() => "row"}
        </List>
      ),
      container
    );
    try {
      setVersion(true);
      expect(container.querySelector("output")!.textContent).toBe("second");
      expect(events).toEqual(["mount:first", "cleanup:first", "mount:second"]);
      const input = container.querySelector("input")!;
      input.value = "new unfinished note";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      setItems([]);
      expect(container.querySelector("input")).toBe(input);
      expect(container.querySelector("output")!.textContent).toBe("new unfinished note");
      expect(events).toHaveLength(3);
      setItems(["row"]);
      expect(events).toHaveLength(4);
      setVersion(false);
      expect(events).toHaveLength(4);
      setItems([]);
      expect(container.querySelector("output")!.textContent).toBe("first");
    } finally {
      dispose();
      container.remove();
    }
    expect(events).toEqual([
      "mount:first",
      "cleanup:first",
      "mount:second",
      "cleanup:second",
      "mount:first",
      "cleanup:first"
    ]);
  });

  test(`${List.name} keeps row owners while a populated list changes length`, () => {
    const [items, setItems] = createSignal(["first"]);
    let mounts = 0,
      cleanups = 0;
    const container = document.createElement("div");
    const dispose = render(
      () => (
        <List each={items()}>
          {item => {
            mounts++;
            onCleanup(() => cleanups++);
            return <input value={typeof item === "function" ? item() : item} />;
          }}
        </List>
      ),
      container
    );
    try {
      const first = container.querySelector("input");
      setItems(["first", "second"]);
      expect(container.querySelector("input")).toBe(first);
      expect(mounts).toBe(2);
      expect(cleanups).toBe(0);
      setItems(["first"]);
      expect(container.querySelector("input")).toBe(first);
      expect(cleanups).toBe(1);
      setItems([]);
      expect(cleanups).toBe(2);
      setItems(["first"]);
      expect(container.querySelector("input")).not.toBe(first);
      expect(mounts).toBe(3);
    } finally {
      dispose();
    }
    expect(cleanups).toBe(3);
  });

  test(`${List.name} preserves fallback context and cleans reactive work when the branch ends`, () => {
    const Context = createContext("missing");
    const [items, setItems] = createSignal<string[]>([]);
    const [value, setValue] = createSignal(0);
    const seen: number[] = [];
    let owner: ReturnType<typeof getOwner>,
      cleanups = 0;
    const Fallback = () => {
      owner = getOwner();
      const context = useContext(Context);
      createComputed(() => {
        seen.push(value());
      });
      onCleanup(() => cleanups++);
      return <b>{context}</b>;
    };
    const container = document.createElement("div");
    const dispose = render(
      () => (
        <Context.Provider value="provided">
          <List each={items()} fallback={<Fallback />}>
            {() => "row"}
          </List>
        </Context.Provider>
      ),
      container
    );
    try {
      expect(container.textContent).toBe("provided");
      expect(owner!).toBeTruthy();
      const initialOwner = owner!;
      setItems([]);
      expect(owner!).toBe(initialOwner);
      setValue(1);
      expect(seen).toEqual([0, 1]);
      setItems(["row"]);
      expect(cleanups).toBe(1);
      setValue(2);
      expect(seen).toEqual([0, 1]);
      setItems([]);
      expect(owner!).not.toBe(initialOwner);
      expect(seen).toEqual([0, 1, 2]);
    } finally {
      dispose();
    }
    expect(cleanups).toBe(2);
    setValue(3);
    expect(seen).toEqual([0, 1, 2]);
  });

  test(`${List.name} retries a failed public fallback after its error boundary resets`, () => {
    let attempts = 0,
      cleanups = 0,
      reset!: () => void;
    const Fallback = () => {
      attempts++;
      onCleanup(() => cleanups++);
      if (attempts === 1) throw Error("try again");
      return <b>ready</b>;
    };
    const container = document.createElement("div");
    const dispose = render(
      () => (
        <ErrorBoundary
          fallback={(_, retry) => {
            reset = retry;
            return "failed";
          }}
        >
          <List each={[]} fallback={<Fallback />}>
            {() => "row"}
          </List>
        </ErrorBoundary>
      ),
      container
    );
    try {
      expect(container.textContent).toBe("failed");
      reset();
      expect(container.textContent).toBe("ready");
      expect(attempts).toBe(2);
      expect(cleanups).toBe(1);
    } finally {
      dispose();
    }
    expect(cleanups).toBe(2);
  });
}

for (const map of [mapArray, indexArray]) {
  test(`${map.name} still evaluates a mutable fallback factory on each empty read`, () => {
    createRoot(dispose => {
      let value: string | undefined = "initial",
        calls = 0,
        cleanups = 0;
      const mapped: () => (string | undefined)[] = map<number, string | undefined>(
        () => [],
        () => "row",
        {
          fallback: () => {
            calls++;
            onCleanup(() => cleanups++);
            return value;
          }
        }
      );
      try {
        expect(mapped()).toEqual(["initial"]);
        value = "updated";
        expect(mapped()).toEqual(["updated"]);
        value = undefined;
        expect(mapped()).toEqual([undefined]);
        expect(mapped()).toEqual([undefined]);
        expect(calls).toBe(4);
        expect(cleanups).toBe(3);
      } finally {
        dispose();
      }
      expect(cleanups).toBe(4);
    });
  });
}

for (const List of [For, Index]) {
  test(`${List.name} hands an exclusive subscription between fallback and rows`, () => {
    let holder: string | undefined;
    const events: string[] = [];
    function subscribe(name: string) {
      if (holder) throw new Error(`${name} overlaps ${holder}`);
      holder = name;
      events.push(`open:${name}`);
      onCleanup(() => {
        expect(holder).toBe(name);
        holder = undefined;
        events.push(`close:${name}`);
      });
      return name;
    }
    const [items, setItems] = createSignal<string[]>([]);
    const Empty = () => subscribe("empty");
    const node = document.createElement("div");
    const dispose = render(
      () => (
        <List each={items()} fallback={<Empty />}>
          {() => subscribe("row")}
        </List>
      ),
      node
    );
    try {
      setItems([]);
      expect(events).toEqual(["open:empty"]);
      setItems(["row"]);
      expect(node.textContent).toBe("row");
      expect(holder).toBe("row");
      setItems([]);
      expect(node.textContent).toBe("empty");
      expect(holder).toBe("empty");
      setItems([]);
      expect(events).toEqual(["open:empty", "close:empty", "open:row", "close:row", "open:empty"]);
    } finally {
      dispose();
    }
    expect(holder).toBeUndefined();
    expect(events.at(-1)).toBe("close:empty");
  });
}

for (const List of [For, Index]) {
  test(`${List.name} captures its mapper prop once even across branch reentry`, () => {
    const [items, setItems] = createSignal<string[]>([]);
    const [mapper, setMapper] = createSignal<() => string>(() => "first");
    let reads = 0;
    const node = document.createElement("div");
    const dispose = render(
      () =>
        List({
          get each() {
            return items();
          },
          fallback: "empty",
          get children() {
            reads++;
            return mapper();
          }
        }),
      node
    );
    try {
      expect(reads).toBe(1);
      setMapper(() => () => "second");
      setItems(["one"]);
      expect(node.textContent).toBe("first");
      setItems(["one", "two"]);
      expect(node.textContent).toBe("firstfirst");
      setItems([]);
      setItems(["one"]);
      expect(node.textContent).toBe("first");
      expect(reads).toBe(1);
    } finally {
      dispose();
    }
  });

  test(`${List.name} retains row owners, inherited context and live work only while populated`, () => {
    const Context = createContext("missing");
    const [items, setItems] = createSignal(["first"]);
    const [tick, setTick] = createSignal(0);
    const owners: ReturnType<typeof getOwner>[] = [];
    const seen: number[] = [];
    let cleanups = 0;
    const node = document.createElement("div");
    const dispose = render(
      () => (
        <Context.Provider value="provided">
          <List each={items()}>
            {() => {
              owners.push(getOwner());
              const context = useContext(Context);
              createComputed(() => seen.push(tick()));
              onCleanup(() => cleanups++);
              return <input value={context} />;
            }}
          </List>
        </Context.Provider>
      ),
      node
    );
    try {
      const first = node.querySelector("input");
      expect(first!.value).toBe("provided");
      expect(owners[0]).toBeTruthy();
      setItems(["first", "second"]);
      setItems(["first"]);
      expect(node.querySelector("input")).toBe(first);
      expect(owners).toHaveLength(2);
      expect(cleanups).toBe(1);
      setTick(1);
      expect(seen).toEqual([0, 0, 1]);
      setItems([]);
      expect(cleanups).toBe(2);
      setTick(2);
      expect(seen).toEqual([0, 0, 1]);
      setItems(["first"]);
      expect(node.querySelector("input")).not.toBe(first);
      expect(owners[2]).not.toBe(owners[0]);
      expect(seen).toEqual([0, 0, 1, 2]);
    } finally {
      dispose();
    }
    expect(cleanups).toBe(3);
    setTick(3);
    expect(seen).toEqual([0, 0, 1, 2]);
  });

  test(`${List.name} reacts to in-place store length and item updates`, () => {
    const [state, setState] = createStore({ items: [] as string[] });
    const node = document.createElement("div");
    const dispose = render(
      () => (
        <List each={state.items} fallback="empty">
          {item => <span>{typeof item === "function" ? item() : item}</span>}
        </List>
      ),
      node
    );
    try {
      setState("items", 0, "one");
      expect(node.textContent).toBe("one");
      setState("items", 0, "changed");
      expect(node.textContent).toBe("changed");
      setState("items", 1, "two");
      expect(node.textContent).toBe("changedtwo");
      setState(
        "items",
        produce(items => {
          items.length = 0;
        })
      );
      expect(node.textContent).toBe("empty");
      setState("items", 0, "again");
      expect(node.textContent).toBe("again");
    } finally {
      dispose();
    }
  });

  test(`${List.name} retries an entering row after its error boundary resets`, () => {
    const [items, setItems] = createSignal<string[]>([]);
    const error = new Error("retry row");
    let attempts = 0,
      cleanups = 0,
      fallbackCleanups = 0;
    let reset!: () => void;
    const Empty = () => {
      onCleanup(() => fallbackCleanups++);
      return "empty";
    };
    const node = document.createElement("div");
    const dispose = render(
      () => (
        <ErrorBoundary
          fallback={(seen, retry) => {
            expect(seen).toBe(error);
            reset = retry;
            return "failed";
          }}
        >
          <List each={items()} fallback={<Empty />}>
            {() => {
              onCleanup(() => cleanups++);
              if (++attempts === 1) throw error;
              return "ready";
            }}
          </List>
        </ErrorBoundary>
      ),
      node
    );
    try {
      setItems(["row"]);
      expect(node.textContent).toBe("failed");
      expect(fallbackCleanups).toBe(1);
      reset();
      expect(node.textContent).toBe("ready");
      expect(attempts).toBe(2);
      expect(cleanups).toBe(1);
      setItems([]);
      expect(cleanups).toBe(2);
      expect(node.textContent).toBe("empty");
    } finally {
      dispose();
    }
    expect(cleanups).toBe(2);
    expect(fallbackCleanups).toBe(2);
  });
}
