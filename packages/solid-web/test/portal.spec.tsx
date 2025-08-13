/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createSignal, flush, Show } from "solid-js";
import { render, clearDelegatedEvents, Portal } from "../src/index.js";

describe("Testing a simple Portal", () => {
  let div = document.createElement("div"),
    disposer: () => void;
  const testMount = document.createElement("div");
  const Component = () => <Portal mount={testMount}>Hi</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(testMount.innerHTML).toBe("Hi");
    expect((testMount.firstChild as Text & { _$host: HTMLElement })._$host).toBe(div);
  });

  test("dispose", () => {
    disposer();
    expect(div.innerHTML).toBe("");
  });
});

describe("Testing an SVG Portal", () => {
  let div = document.createElement("div"),
    disposer: () => void;
  const testMount = document.createElement("svg");
  const Component = () => <Portal mount={testMount}>Hi</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(testMount.innerHTML).toBe("Hi");
    expect((testMount.firstChild as Text & { _$host: HTMLElement })._$host).toBe(div);
  });

  test("dispose", () => disposer());
});

describe("Testing a Portal to the head", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    [s, set] = createSignal("A Meaningful Page Title"),
    [visible, setVisible] = createSignal(true);
  const Component = () => (
    <Show when={visible()}>
      <Portal mount={document.head}>
        <title>{s()}</title>
      </Portal>
    </Show>
  );

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(document.head.innerHTML).toBe("<title>A Meaningful Page Title</title>");
  });

  test("Update title text", () => {
    set("A New Better Page Title");
    flush();
    expect(document.head.innerHTML).toBe("<title>A New Better Page Title</title>");
  });

  test("Hide Portal", () => {
    setVisible(false);
    flush();
    expect(document.head.innerHTML).toBe("");
    setVisible(true);
    flush();
    expect(document.head.innerHTML).toBe("<title>A New Better Page Title</title>");
  });

  test("dispose", async () => {
    expect(document.head.innerHTML).toBe("<title>A New Better Page Title</title>");
    disposer();
    expect(document.head.innerHTML).toBe("");
  });
});

describe("Testing a Portal with Synthetic Events", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    testElem!: HTMLDivElement,
    clicked = false;
  const Component = () => (
    <Portal>
      <div ref={testElem} onClick={e => (clicked = true)} />
    </Portal>
  );

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
  });

  test("Test portal element clicked", () => {
    expect(clicked).toBe(false);
    testElem.click();
    expect(clicked).toBe(true);
    // clicked = false;
    // clearDelegatedEvents();
    // expect(clicked).toBe(false);
    // testElem.click();
    // expect(clicked).toBe(false);
  });

  test("dispose", () => disposer());
});

describe("Testing a Portal with direct reactive children", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    [count, setCount] = createSignal(1);
  const Component = () => <Portal>{count()}</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(document.body.innerHTML).toBe("1");
  });

  test("Click to trigger reactive update", () => {
    expect(document.body.innerHTML).toBe("1");
    setCount(count() + 1);
    flush();
    expect(document.body.innerHTML).toBe("2");
    setCount(count() + 1);
    flush();
    expect(document.body.innerHTML).toBe("3");
  });

  test("dispose", () => disposer());
});
