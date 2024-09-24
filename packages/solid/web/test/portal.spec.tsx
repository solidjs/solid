/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createSignal } from "../../src/index.js";
import { render, clearDelegatedEvents, Portal, Show } from "../src/index.js";

describe("Testing a simple Portal", () => {
  let div = document.createElement("div"),
    disposer: () => void;
  const testMount = document.createElement("div");
  const Component = () => <Portal mount={testMount}>Hi</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect((testMount.firstChild as HTMLDivElement).innerHTML).toBe("Hi");
    expect((testMount.firstChild as HTMLDivElement & { _$host: HTMLElement })._$host).toBe(div);
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
  const Component = () => (
    <Portal mount={testMount} isSVG={true}>
      Hi
    </Portal>
  );

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect((testMount.firstChild as SVGGElement).innerHTML).toBe("Hi");
    expect((testMount.firstChild as SVGGElement & { _$host: SVGElement })._$host).toBe(div);
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
    expect(document.head.innerHTML).toBe("<title>A New Better Page Title</title>");
  });

  test("Hide Portal", () => {
    setVisible(false);
    expect(document.head.innerHTML).toBe("");
    setVisible(true);
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
    checkElem: HTMLDivElement,
    testElem: HTMLDivElement,
    clicked = false;
  const Component = () => (
    <Portal ref={checkElem}>
      <div ref={testElem} onClick={e => (clicked = true)} />
    </Portal>
  );

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(testElem).toBe(checkElem.firstChild);
  });

  test("Test portal element clicked", () => {
    expect(clicked).toBe(false);
    testElem.click();
    expect(clicked).toBe(true);
    clicked = false;
    clearDelegatedEvents();
    expect(clicked).toBe(false);
    testElem.click();
    expect(clicked).toBe(false);
  });

  test("dispose", () => disposer());
});

describe("Testing a Portal with direct reactive children", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    [count, setCount] = createSignal(0),
    portalElem: HTMLDivElement;
  const Component = () => <Portal ref={portalElem}>{count()}</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(document.body.firstChild).toBe(portalElem);
  });

  test("Click to trigger reactive update", () => {
    expect(portalElem.innerHTML).toBe("0");
    setCount(count() + 1);
    expect(portalElem.innerHTML).toBe("1");
    setCount(count() + 1);
    expect(portalElem.innerHTML).toBe("2");
  });

  test("dispose", () => disposer());
});
