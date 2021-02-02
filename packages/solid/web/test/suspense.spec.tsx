/* @jsxImportSource solid-js */
import { lazy, createSignal, createResource, useTransition } from "../../src";
import { render, Suspense, SuspenseList } from "../src";

describe("Testing Suspense", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    resolvers: Function[] = [],
    [triggered, trigger] = createSignal(false);
  const LazyComponent = lazy<typeof ChildComponent>(() => new Promise(r => resolvers.push(r))),
    ChildComponent = (props: { greeting: string }) => {
      let [value] = createResource<string>(
        () =>  triggered() ? "child" : null,
        () => new Promise(r => setTimeout(() => r("Jo"), 300)),
        ""
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

  test("Toggle Suspense control flow", done => {
    for (const r of resolvers) r({ default: ChildComponent });
    setTimeout(() => {
      expect(div.innerHTML).toBe("Hi, .Hello ");
      done();
    });
  });

  test("Toggle with refresh transition", done => {
    const [pending, start] = useTransition();
    start(() => trigger(true));
    expect(div.innerHTML).toBe("Hi, .Hello ");
    expect(pending()).toBe(true);
    setTimeout(() => {
      expect(div.innerHTML).toBe("Hi, .Hello ");
      expect(pending()).toBe(true);
    });
    setTimeout(() => {
      expect(div.innerHTML).toBe("Hi, Jo.Hello Jo");
      expect(pending()).toBe(false);
      done();
    }, 400);
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

  test("revealOrder together", done => {
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
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
    }, 110);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
    }, 210);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
      dispose();
      done();
    }, 310);
  });

  test("revealOrder forwards", done => {
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
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
    }, 110);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");
    }, 210);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
      dispose();
      done();
    }, 310);
  });

  test("revealOrder forwards hidden", done => {
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
    setTimeout(() => {
      expect(div.innerHTML).toBe("");
    }, 110);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div>");
    }, 210);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
      dispose();
      done();
    }, 310);
  });

  test("revealOrder forwards", done => {
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
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
    }, 110);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");
    }, 210);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
      dispose();
      done();
    }, 310);
  });

  test("revealOrder forwards collapse", done => {
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
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>Loading 1</div>");
    }, 110);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");
    }, 210);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
      dispose();
      done();
    }, 310);
  });

  test("revealOrder backwards collapse", done => {
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
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>Loading 3</div>");
    }, 110);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>Loading 3</div>");
    }, 210);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
      dispose();
      done();
    }, 310);
  });

  test("nested SuspenseList together", done => {
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
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
    }, 110);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
    }, 210);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
      dispose();
      done();
    }, 310);
  });

  test("nested SuspenseList forwards", done => {
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
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>");
    }, 110);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>Loading 3</div>");
    }, 210);
    setTimeout(() => {
      expect(div.innerHTML).toBe("<div>A</div><div>B</div><div>C</div>");
      dispose();
      done();
    }, 310);
  });
});
