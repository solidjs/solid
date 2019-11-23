import {
  lazy,
  createSignal,
  createEffect,
  loadResource,
  sample,
  Resource,
  useTransition
} from "../../src";
import { render, Suspense } from "../../src/dom";

describe("Testing a context suspend control flow", () => {
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
      <Suspense fallback={"Loading"}>
        <LazyComponent greeting={"Hi, "} />
        <LazyComponent greeting={"Jo"} />
      </Suspense>
    ),
    Component2 = () => (
      <Suspense fallback={"Loading"}>
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
