/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4964: `<C {...fn()} />` calls `fn` with no arguments, as written. The
// compiler used to pass `fn` itself to mergeProps, which memoizes a function
// source, so after the first run `fn` was called with its previous result.
import { test, expect } from "vitest";
import { createSignal, flush } from "solid-js";
import { render } from "../src/index.js";

function Child(props: { "data-count"?: number }) {
  return <div data-count={props["data-count"]} />;
}

test("{...fn()} on a component calls fn with no arguments", () => {
  const [count, setCount] = createSignal(0);
  const received: unknown[] = [];
  const getProps = (extra?: object) => {
    received.push(extra);
    return { "data-count": count(), ...extra };
  };
  const root = document.createElement("div");
  const dispose = render(() => <Child {...getProps()} />, root);
  flush();
  setCount(1);
  flush();
  expect(received.length).toBeGreaterThan(1);
  expect(received.every(extra => extra === undefined)).toBe(true);
  expect((root.firstChild as HTMLElement).dataset.count).toBe("1");
  dispose();
});
