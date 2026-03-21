/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */

import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import "./MessageChannel.js";
import { lazy, createSignal, createMemo, Loading, createStore, flush } from "solid-js";
import { render } from "../src/index.js";

// enableScheduling();

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

  // test("Toggle with refresh transition", async () => {
  //   const [pending, start] = useTransition();
  //   let finished = false;

  //   start(() => trigger("Jo")).then(() => (finished = true));
  //   expect(div.innerHTML).toBe("Hi, .Hello ");
  //   expect(finished).toBe(false);
  //   // wait trigger resource refetch
  //   await Promise.resolve();

  //   expect(div.innerHTML).toBe("Hi, .Hello ");
  //   expect(pending()).toBe(true);
  //   expect(finished).toBe(false);

  //   // Exhausts create-resource setTimeout
  //   vi.runAllTimers();
  //   // wait update suspense state
  //   await Promise.resolve();
  //   // wait update computation
  //   vi.runAllTimers();
  //   // wait write signal suc
  //   await Promise.resolve();

  //   vi.runAllTimers();
  //   await Promise.resolve();

  //   expect(div.innerHTML).toBe("Hi, Jo.Hello Jo");
  //   expect(pending()).toBe(false);
  //   expect(finished).toBe(true);
  // });

  // test("Toggle with store and refresh transition", async () => {
  //   const [store, setStore] = createStore({ count: 0 });
  //   const [pending, start] = useTransition();
  //   let finished = false;

  //   start(() => {
  //     setStore({ count: 1 });
  //     trigger("Jack");
  //   }).then(() => (finished = true));

  //   expect(store.count).toBe(0);
  //   expect(finished).toBe(false);
  //   // wait trigger resource refetch
  //   await Promise.resolve();

  //   expect(store.count).toBe(0);
  //   expect(pending()).toBe(true);
  //   expect(finished).toBe(false);

  //   // Exhausts create-resource setTimeout
  //   vi.runAllTimers();
  //   // wait update suspense state
  //   await Promise.resolve();
  //   // wait update computation
  //   vi.runAllTimers();

  //   // Await the rest of the things, TODO: figure out what these are
  //   await Promise.resolve();
  //   vi.runAllTimers();
  //   await Promise.resolve();

  //   expect(pending()).toBe(false);
  //   expect(finished).toBe(true);
  //   expect(store.count).toBe(1);
  // });

  test("dispose", () => {
    div.innerHTML = "";
    disposer();
  });
});

// describe("SuspenseList", () => {
//   const promiseFactory = (time: number) => {
//       return (v: string) =>
//         new Promise<string>(r => {
//           setTimeout(() => {
//             r(v);
//           }, time);
//         });
//     },
//     A = () => {
//       const [value] = createResource("A", promiseFactory(200));
//       return <div>{value()}</div>;
//     },
//     B = () => {
//       const [value] = createResource("B", promiseFactory(100));
//       return <div>{value()}</div>;
//     },
//     C = () => {
//       const [value] = createResource("C", promiseFactory(300));
//       return <div>{value()}</div>;
//     };

//   test("revealOrder together", async () => {
//     const div = document.createElement("div"),
//       Comp = () => (
//         <SuspenseList revealOrder="together">
//           <Suspense fallback={<div>Loading 1</div>}>
//             <A />
//           </Suspense>
//           <Suspense fallback={<div>Loading 2</div>}>
//             <B />
//           </Suspense>
//           <Suspense fallback={<div>Loading 3</div>}>
//             <C />
//           </Suspense>
//         </SuspenseList>
//       );
//     const dispose = render(Comp, div);
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
//     vi.advanceTimersByTime(110);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
//     vi.advanceTimersByTime(100);
//     // wait effect update
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
//     dispose();
//   });

//   test("revealOrder forwards", async () => {
//     const div = document.createElement("div"),
//       Comp = () => (
//         <SuspenseList revealOrder="forwards">
//           <Suspense fallback={<div>Loading 1</div>}>
//             <A />
//           </Suspense>
//           <Suspense fallback={<div>Loading 2</div>}>
//             <B />
//           </Suspense>
//           <Suspense fallback={<div>Loading 3</div>}>
//             <C />
//           </Suspense>
//         </SuspenseList>
//       );
//     const dispose = render(Comp, div);
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(110);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
//     dispose();
//   });

//   test("revealOrder forwards hidden", async () => {
//     const div = document.createElement("div"),
//       Comp = () => (
//         <SuspenseList revealOrder="forwards" tail="hidden">
//           <Suspense fallback={<div>Loading 1</div>}>
//             <A />
//           </Suspense>
//           <Suspense fallback={<div>Loading 2</div>}>
//             <B />
//           </Suspense>
//           <Suspense fallback={<div>Loading 3</div>}>
//             <C />
//           </Suspense>
//         </SuspenseList>
//       );
//     const dispose = render(Comp, div);
//     expect(div.innerHTML).toBe("");

//     vi.advanceTimersByTime(110);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
//     dispose();
//   });

//   test("revealOrder forwards", async () => {
//     const div = document.createElement("div"),
//       Comp = () => (
//         <SuspenseList revealOrder="forwards">
//           <Suspense fallback={<div>Loading 1</div>}>
//             <A />
//           </Suspense>
//           <Suspense fallback={<div>Loading 2</div>}>
//             <B />
//           </Suspense>
//           <Suspense fallback={<div>Loading 3</div>}>
//             <C />
//           </Suspense>
//         </SuspenseList>
//       );
//     const dispose = render(Comp, div);
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(110);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
//     dispose();
//   });

//   test("revealOrder forwards collapse", async () => {
//     const div = document.createElement("div"),
//       Comp = () => (
//         <SuspenseList revealOrder="forwards" tail="collapsed">
//           <Suspense fallback={<div>Loading 1</div>}>
//             <A />
//           </Suspense>
//           <Suspense fallback={<div>Loading 2</div>}>
//             <B />
//           </Suspense>
//           <Suspense fallback={<div>Loading 3</div>}>
//             <C />
//           </Suspense>
//         </SuspenseList>
//       );
//     const dispose = render(Comp, div);
//     expect(div.innerHTML).toBe("<div>Loading 1</div>");

//     vi.advanceTimersByTime(110);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>Loading 1</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
//     dispose();
//   });

//   test("revealOrder backwards collapse", async () => {
//     const div = document.createElement("div"),
//       Comp = () => (
//         <SuspenseList revealOrder="backwards" tail="collapsed">
//           <Suspense fallback={<div>Loading 1</div>}>
//             <A />
//           </Suspense>
//           <Suspense fallback={<div>Loading 2</div>}>
//             <B />
//           </Suspense>
//           <Suspense fallback={<div>Loading 3</div>}>
//             <C />
//           </Suspense>
//         </SuspenseList>
//       );
//     const dispose = render(Comp, div);
//     expect(div.innerHTML).toBe("<div>Loading 3</div>");

//     vi.advanceTimersByTime(110);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>Loading 3</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>Loading 3</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
//     dispose();
//   });

//   test("nested SuspenseList together", async () => {
//     const div = document.createElement("div"),
//       Comp = () => (
//         <SuspenseList revealOrder="together">
//           <SuspenseList revealOrder="together">
//             <Suspense fallback={<div>Loading 1</div>}>
//               <A />
//             </Suspense>
//           </SuspenseList>
//           <SuspenseList revealOrder="together">
//             <Suspense fallback={<div>Loading 2</div>}>
//               <B />
//             </Suspense>
//             <Suspense fallback={<div>Loading 3</div>}>
//               <C />
//             </Suspense>
//           </SuspenseList>
//         </SuspenseList>
//       );
//     const dispose = render(Comp, div);
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(110);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
//     dispose();
//   });

//   test("nested SuspenseList forwards", async () => {
//     const div = document.createElement("div"),
//       Comp = () => (
//         <SuspenseList revealOrder="forwards">
//           <SuspenseList revealOrder="forwards">
//             <Suspense fallback={<div>Loading 1</div>}>
//               <A />
//             </Suspense>
//           </SuspenseList>
//           <SuspenseList revealOrder="forwards">
//             <Suspense fallback={<div>Loading 2</div>}>
//               <B />
//             </Suspense>
//             <Suspense fallback={<div>Loading 3</div>}>
//               <C />
//             </Suspense>
//           </SuspenseList>
//         </SuspenseList>
//       );
//     const dispose = render(Comp, div);
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(110);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");

//     vi.advanceTimersByTime(100);
//     await Promise.resolve();
//     expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
//     dispose();
//   });
// });
