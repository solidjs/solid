import {
  lazy,
  createSignal,
  createEffect,
  createResource,
  createResourceState,
  load,
  sample,
  useTransition
} from "../../src";
import { render, Suspense, SuspenseList } from "../../src/dom";

describe("Testing a Suspense", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    resolvers: Function[] = [],
    [triggered, trigger] = createSignal(false),
    reloader: () => void;
  const LazyComponent = lazy<typeof ChildComponent>(
      () => new Promise(r => resolvers.push(r))
    ),
    ChildComponent = (props: { greeting: string }) => {
      let [value, setValue] = createResource<string>();
      createEffect(
        () =>
          triggered() &&
          load<string>(
            () => new Promise(r => setTimeout(() => r("Hey"), 300)),
            setValue
          ) &&
          sample(value)
      );
      return props.greeting;
    },
    ChildComponent2 = () => {
      let [value, setValue] = createResource<string>(),
        [, reload] = load<string>(
          () => new Promise(r => setTimeout(() => r("Finally"), 300)),
          setValue
        );
      reloader = () => (setValue(undefined), reload());
      return <>{value}</>;
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
    const [, start] = useTransition({ timeoutMs: 100 });
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
      reloader();
      expect(div.innerHTML).toBe("Loading");
      setTimeout(() => {
        expect(div.innerHTML).toBe("Finally");
        done();
      }, 400);
    }, 400);
  });

  test("dispose", () => disposer());
});

describe("Testing Suspense with State", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    reloader: () => void;
  const ChildComponent = (props: { name: string }) => {
      const [state, setState] = createResourceState<{ greeting?: string }>({ greeting: undefined }),
        [loading, reload] = load<{ greeting: string }>(
            () => new Promise(r => setTimeout(() => r({ greeting: "Hey" }), 300)),
            v => v && setState(v)
          );
      reloader = () => (setState({ greeting: undefined }), reload());
      return <>{!loading() && `${state.greeting}, ${props.name}`}</>;
    },
    Component = () => (
      <Suspense fallback="Loading">
        <ChildComponent name="Jo!" />
        <ChildComponent name="Jacob!" />
      </Suspense>
    );

  test("Create suspend control flow", done => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("Loading");
    setTimeout(() => {
      expect(div.innerHTML).toBe("Hey, Jo!Hey, Jacob!");
      done();
    }, 400);
  });

  test("dispose", () => {
    div.innerHTML = "";
    disposer();
  });
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
      const [value, setValue] = createResource<string>();
      load(() => promiseFactory(200, "A"), setValue);
      return <div>{value}</div>;
    },
    B = () => {
      const [value, setValue] = createResource<string>();
      load(() => promiseFactory(100, "B"), setValue);
      return <div>{value}</div>;
    },
    C = () => {
      const [value, setValue] = createResource<string>();
      load(() => promiseFactory(300, "C"), setValue);
      return <div>{value}</div>;
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
});
