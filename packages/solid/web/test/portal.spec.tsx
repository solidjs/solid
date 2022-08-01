/** 
 * @jsxImportSource solid-js
 * @jest-environment jsdom
 */

import { createSignal } from "../../src";
import { render, clearDelegatedEvents, Portal, Show } from "../src";

describe("Testing a simple Portal", () => {
  let div = document.createElement("div"),
    disposer: () => void;
  const testMount = document.createElement("div");
  const Component = () => <Portal mount={testMount}>Hi</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect((testMount.firstChild as HTMLDivElement).innerHTML).toBe("Hi");
    expect((testMount.firstChild as HTMLDivElement & { host: HTMLElement }).host).toBe(div);
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
  const Component = () => <Portal mount={testMount} isSVG={true}>Hi</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect((testMount.firstChild as SVGGElement).innerHTML).toBe("Hi");
    expect((testMount.firstChild as SVGGElement & { host: SVGElement }).host).toBe(div);
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
