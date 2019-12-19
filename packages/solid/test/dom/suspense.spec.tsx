import {
  lazy,
  createSignal,
  createEffect,
  loadResource,
  sample,
  Resource,
  useTransition
} from "../../src";
import { render, Suspense, SuspenseList } from "../../src/dom";

describe("Testing a Suspense", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    resolvers: Function[] = [],
    [triggered, trigger] = createSignal(false),
    reloader: (delay: number) => void;
  const LazyComponent = lazy<typeof ChildComponent>(
      () => new Promise(r => resolvers.push(r))
    ),
    ChildComponent = (props: { greeting: string }) => {
      let result: Resource<unknown>;
      createEffect(
        () =>
          triggered() &&
          (result = loadResource(() => new Promise(r => setTimeout(r, 300)))) &&
          sample(() => result.value)
      );
      return props.greeting;
    },
    ChildComponent2 = () => {
      let result: Resource<string> = loadResource(
        () => new Promise(r => setTimeout(() => r("Finally"), 300))
      );
      reloader = result.reload;
      return <>{result.value}</>;
    },
    Component = () => (
      <Suspense fallback="Loading">
        <LazyComponent greeting="Hi, " />
        <LazyComponent greeting="Jo" />
      </Suspense>
    ),
    Component2 = () => (
      <Suspense fallback="Loading">
        <ChildComponent2 />
      </Suspense>
    );

  test("Create suspend control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("Loading");
  });

  test("Toggle suspend control flow", done => {
    for (const r of resolvers) r({ default: ChildComponent });
    setTimeout(() => {
      expect(div.innerHTML).toBe("Hi, Jo");
      done();
    });
  });

  test("Toggle with delayed fallback", done => {
    const [start] = useTransition({ timeoutMs: 100 });
    start(() => trigger(true));
    expect(div.innerHTML).toBe("Hi, Jo");
    setTimeout(() => {
      expect(div.innerHTML).toBe("Hi, Jo");
    });
    setTimeout(() => {
      expect(div.innerHTML).toBe("Loading");
    }, 200);
    setTimeout(() => {
      expect(div.innerHTML).toBe("Hi, Jo");
      done();
    }, 400);
  });

  test("dispose", () => {
    div.innerHTML = "";
    disposer();
  });

  test("multi trigger resource", done => {
    disposer = render(Component2, div);
    expect(div.innerHTML).toBe("Loading");
    setTimeout(() => {
      expect(div.innerHTML).toBe("Finally");
      reloader(0);
      expect(div.innerHTML).toBe("Loading");
      setTimeout(() => {
        expect(div.innerHTML).toBe("Finally");
        done();
      }, 400);
    }, 400);
  });

  test("dispose", () => disposer());
});

describe("SuspenseList", () => {
  const promiseFactory = (time: number, v: string) => {
      return new Promise<string>(r => {
        setTimeout(() => {
          r(v);
        }, time);
      });
    },
    A = () => {
      const r = loadResource(() => promiseFactory(200, "A"));
      return <div>{r.value}</div>;
    },
    B = () => {
      const r = loadResource(() => promiseFactory(100, "B"));
      return <div>{r.value}</div>;
    },
    C = () => {
      const r = loadResource(() => promiseFactory(300, "C"));
      return <div>{r.value}</div>;
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
    expect(div.innerHTML).toBe(
      "<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>"
    );
    setTimeout(() => {
      expect(div.innerHTML).toBe(
        "<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>"
      );
    }, 110);
    setTimeout(() => {
      expect(div.innerHTML).toBe(
        "<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>"
      );
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
    expect(div.innerHTML).toBe(
      "<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>"
    );
    setTimeout(() => {
      expect(div.innerHTML).toBe(
        "<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>"
      );
    }, 110);
    setTimeout(() => {
      expect(div.innerHTML).toBe(
        "<div>A</div><div>B</div><div>Loading 3</div>"
      );
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
    expect(div.innerHTML).toBe(
      "<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>"
    );
    setTimeout(() => {
      expect(div.innerHTML).toBe(
        "<div>Loading 1</div><div>Loading 2</div><div>Loading 3</div>"
      );
    }, 110);
    setTimeout(() => {
      expect(div.innerHTML).toBe(
        "<div>A</div><div>B</div><div>Loading 3</div>"
      );
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
      expect(div.innerHTML).toBe(
        "<div>A</div><div>B</div><div>Loading 3</div>"
      );
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
