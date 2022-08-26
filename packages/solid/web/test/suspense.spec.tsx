/**
 * @jsxImportSource solid-js
 * @jest-environment jsdom
 */

import "../../test/MessageChannel";
import { lazy, createSignal, createResource, useTransition, enableScheduling } from "../../src";
import { render, Suspense, SuspenseList } from "../src";
import { createStore } from "../../store/src";

enableScheduling();

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});
describe("Testing Basics", () => {
  test("Children are reactive", () => {
    let div = document.createElement("div");
    let increment: () => void;
    render(() => {
      const [count, setCount] = createSignal(0);
      increment = () => setCount(count() + 1);
      return <Suspense>{count()}</Suspense>;
    }, div);
    expect(div.innerHTML).toBe("0");
    increment!();
    expect(div.innerHTML).toBe("1");
  });
});
describe("Testing Suspense", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    resolvers: Function[] = [],
    [triggered, trigger] = createSignal<string>();
  const LazyComponent = lazy<typeof ChildComponent>(() => new Promise(r => resolvers.push(r))),
    ChildComponent = (props: { greeting: string }) => {
      const [value] = createResource<string, string>(
        triggered,
        () => new Promise(r => setTimeout(() => r("Jo"), 300)),
        { initialValue: "" }
      );
      return () => `${props.greeting} ${value()}`;
    },
    Component = () => (
      <Suspense fallback="Loading">
        <LazyComponent greeting="Hi," />.
        <LazyComponent greeting="Hello" />
      </Suspense>
    );

  test("Create Suspense control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("Loading");
  });

  test("Toggle Suspense control flow", async () => {
    for (const r of resolvers) r({ default: ChildComponent });

    await Promise.resolve();
    jest.runAllTimers();
    await Promise.resolve();

    expect(div.innerHTML).toBe("Hi, .Hello ");
  });

  test("Toggle with refresh transition", async () => {
    const [pending, start] = useTransition();
    let finished = false;

    start(() => trigger("Jo")).then(() => (finished = true));
    expect(div.innerHTML).toBe("Hi, .Hello ");
    expect(finished).toBe(false);
    // wait trigger resource refetch
    await Promise.resolve();

    expect(div.innerHTML).toBe("Hi, .Hello ");
    expect(pending()).toBe(true);
    expect(finished).toBe(false);

    // Exhausts create-resource setTimeout
    jest.runAllTimers();
    // wait update suspence state
    await Promise.resolve();
    // wait update computation
    jest.runAllTimers();
    // wait write signal suc
    await Promise.resolve();

    jest.runAllTimers();
    await Promise.resolve();

    expect(div.innerHTML).toBe("Hi, Jo.Hello Jo");
    expect(pending()).toBe(false);
    expect(finished).toBe(true);
  });

  test("Toggle with store and refresh transition", async () => {
    const [store, setStore] = createStore({ count: 0 });
    const [pending, start] = useTransition();
    let finished = false;

    start(() => {
      setStore({ count: 1 });
      trigger("Jack");
    }).then(() => (finished = true));

    expect(store.count).toBe(0);
    expect(finished).toBe(false);
    // wait trigger resource refetch
    await Promise.resolve();

    expect(store.count).toBe(0);
    expect(pending()).toBe(true);
    expect(finished).toBe(false);

    // Exhausts create-resource setTimeout
    jest.runAllTimers();
    // wait update suspence state
    await Promise.resolve();
    // wait update computation
    jest.runAllTimers();

    // Await the rest of the things, TODO: figure out what these are
    await Promise.resolve();
    jest.runAllTimers();
    await Promise.resolve();

    expect(pending()).toBe(false);
    expect(finished).toBe(true);
    expect(store.count).toBe(1);
  });

  test("dispose", () => {
    div.innerHTML = "";
    disposer();
  });
});

describe("SuspenseList", () => {
  const promiseFactory = (time: number) => {
      return (v: string) =>
        new Promise<string>(r => {
          setTimeout(() => {
            r(v);
          }, time);
        });
    },
    A = () => {
      const [value] = createResource("A", promiseFactory(200));
      return <div>{value()}</div>;
    },
    B = () => {
      const [value] = createResource("B", promiseFactory(100));
      return <div>{value()}</div>;
    },
    C = () => {
      const [value] = createResource("C", promiseFactory(300));
      return <div>{value()}</div>;
    };

  test("revealOrder together", async () => {
    const div = document.createElement("div"),
      Comp = () => (
        <SuspenseList revealOrder="together">
          <Suspense fallback={<div>Loading 1</div>}>
            <A />
          </Suspense>
          <Suspense fallback={<div>Loading 2</div>}>
            <B />
          </Suspense>
          <Suspense fallback={<div>Loading 3</div>}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    const dispose = render(Comp, div);
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
    jest.advanceTimersByTime(110);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
    jest.advanceTimersByTime(100);
    // wait effect update
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
    dispose();
  });

  test("revealOrder forwards", async () => {
    const div = document.createElement("div"),
      Comp = () => (
        <SuspenseList revealOrder="forwards">
          <Suspense fallback={<div>Loading 1</div>}>
            <A />
          </Suspense>
          <Suspense fallback={<div>Loading 2</div>}>
            <B />
          </Suspense>
          <Suspense fallback={<div>Loading 3</div>}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    const dispose = render(Comp, div);
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

    jest.advanceTimersByTime(110);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
    dispose();
  });

  test("revealOrder forwards hidden", async () => {
    const div = document.createElement("div"),
      Comp = () => (
        <SuspenseList revealOrder="forwards" tail="hidden">
          <Suspense fallback={<div>Loading 1</div>}>
            <A />
          </Suspense>
          <Suspense fallback={<div>Loading 2</div>}>
            <B />
          </Suspense>
          <Suspense fallback={<div>Loading 3</div>}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    const dispose = render(Comp, div);
    expect(div.innerHTML).toBe("");

    jest.advanceTimersByTime(110);
    await Promise.resolve();
    expect(div.innerHTML).toBe("");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
    dispose();
  });

  test("revealOrder forwards", async () => {
    const div = document.createElement("div"),
      Comp = () => (
        <SuspenseList revealOrder="forwards">
          <Suspense fallback={<div>Loading 1</div>}>
            <A />
          </Suspense>
          <Suspense fallback={<div>Loading 2</div>}>
            <B />
          </Suspense>
          <Suspense fallback={<div>Loading 3</div>}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    const dispose = render(Comp, div);
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

    jest.advanceTimersByTime(110);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
    dispose();
  });

  test("revealOrder forwards collapse", async () => {
    const div = document.createElement("div"),
      Comp = () => (
        <SuspenseList revealOrder="forwards" tail="collapsed">
          <Suspense fallback={<div>Loading 1</div>}>
            <A />
          </Suspense>
          <Suspense fallback={<div>Loading 2</div>}>
            <B />
          </Suspense>
          <Suspense fallback={<div>Loading 3</div>}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    const dispose = render(Comp, div);
    expect(div.innerHTML).toBe("<div>Loading 1</div>");

    jest.advanceTimersByTime(110);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>Loading 1</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
    dispose();
  });

  test("revealOrder backwards collapse", async () => {
    const div = document.createElement("div"),
      Comp = () => (
        <SuspenseList revealOrder="backwards" tail="collapsed">
          <Suspense fallback={<div>Loading 1</div>}>
            <A />
          </Suspense>
          <Suspense fallback={<div>Loading 2</div>}>
            <B />
          </Suspense>
          <Suspense fallback={<div>Loading 3</div>}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    const dispose = render(Comp, div);
    expect(div.innerHTML).toBe("<div>Loading 3</div>");

    jest.advanceTimersByTime(110);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>Loading 3</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>Loading 3</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
    dispose();
  });

  test("nested SuspenseList together", async () => {
    const div = document.createElement("div"),
      Comp = () => (
        <SuspenseList revealOrder="together">
          <SuspenseList revealOrder="together">
            <Suspense fallback={<div>Loading 1</div>}>
              <A />
            </Suspense>
          </SuspenseList>
          <SuspenseList revealOrder="together">
            <Suspense fallback={<div>Loading 2</div>}>
              <B />
            </Suspense>
            <Suspense fallback={<div>Loading 3</div>}>
              <C />
            </Suspense>
          </SuspenseList>
        </SuspenseList>
      );
    const dispose = render(Comp, div);
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

    jest.advanceTimersByTime(110);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
    dispose();
  });

  test("nested SuspenseList forwards", async () => {
    const div = document.createElement("div"),
      Comp = () => (
        <SuspenseList revealOrder="forwards">
          <SuspenseList revealOrder="forwards">
            <Suspense fallback={<div>Loading 1</div>}>
              <A />
            </Suspense>
          </SuspenseList>
          <SuspenseList revealOrder="forwards">
            <Suspense fallback={<div>Loading 2</div>}>
              <B />
            </Suspense>
            <Suspense fallback={<div>Loading 3</div>}>
              <C />
            </Suspense>
          </SuspenseList>
        </SuspenseList>
      );
    const dispose = render(Comp, div);
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

    jest.advanceTimersByTime(110);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
    dispose();
  });
});
