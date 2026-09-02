/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { render, spread } from "@solidjs/web";
import { createRoot, createSignal, flush } from "solid-js";
import type { JSX } from "../src/index.js";

describe("Event handlers", () => {
  test("reuses a bound handler tuple across non-delegated events", () => {
    const calls: Array<[string, HTMLDivElement, Event]> = [];
    const originalHandler = (data: string, event: Event) => {
      calls.push([data, event.currentTarget as HTMLDivElement, event]);
    };
    const handler: JSX.BoundEventHandler<HTMLDivElement, Event> = [originalHandler, "shared"];
    const container = document.createElement("div");
    const dispose = render(
      () => (
        <>
          <div onScroll={handler} />
          <div onScroll={handler} />
        </>
      ),
      container
    );
    const [first, second] = Array.from(container.children) as HTMLDivElement[];
    const firstEvent = new Event("scroll");
    const secondEvent = new Event("scroll");

    first.dispatchEvent(firstEvent);
    second.dispatchEvent(secondEvent);

    expect(calls).toEqual([
      ["shared", first, firstEvent],
      ["shared", second, secondEvent]
    ]);
    expect(handler).toEqual([originalHandler, "shared"]);
    dispose();
  });

  test("removes the previous non-delegated bound handler when a spread rebinds", () => {
    type Handler = JSX.BoundEventHandler<HTMLDivElement, Event>;
    const calls: string[] = [];
    const handlers: Handler[] = ["first", "second", "third"].map(data => [
      value => calls.push(value),
      data
    ]);
    const [props, setProps] = createSignal<{ onScroll?: Handler }>({
      onScroll: handlers[0]
    });
    const container = document.createElement("div");
    const dispose = render(() => <div {...props()} />, container);
    const element = container.firstElementChild as HTMLDivElement;

    element.dispatchEvent(new Event("scroll"));

    setProps({ onScroll: handlers[1] });
    flush();
    element.dispatchEvent(new Event("scroll"));

    setProps({ onScroll: handlers[2] });
    flush();
    element.dispatchEvent(new Event("scroll"));

    setProps({});
    flush();
    element.dispatchEvent(new Event("scroll"));

    expect(calls).toEqual(["first", "second", "third"]);
    expect(handlers.map(handler => handler[1])).toEqual(["first", "second", "third"]);
    dispose();
  });

  test("does not rebind an unchanged tuple when another spread property updates", () => {
    const handler: JSX.BoundEventHandler<HTMLDivElement, Event> = [() => {}, "shared"];
    const [props, setProps] = createSignal({ onScroll: handler, title: "first" });
    const element = document.createElement("div");
    const add = vi.spyOn(element, "addEventListener");
    const remove = vi.spyOn(element, "removeEventListener");
    const dispose = createRoot(dispose => {
      spread(element, props, true);
      return dispose;
    });

    flush();
    expect(add).toHaveBeenCalledTimes(1);

    setProps({ onScroll: handler, title: "second" });
    flush();

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    dispose();
  });
});
