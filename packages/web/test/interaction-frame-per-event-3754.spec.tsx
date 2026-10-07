/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { addEvent, dispatchAsInteraction, render } from "@solidjs/web";
import { OBSERVE, createEffect, createSignal, flush } from "solid-js";
import type { InteractionEvent } from "solid-js/attribution";
import { attribution } from "solid-js/attribution";

/**
 * #3754: one interaction frame per event, not per listener. The render
 * root's delegated listener opens the click's frame; a listener outside the
 * runtime (a router on `document`) that dispatches through the runtime joins
 * it, so one click is one record carrying both listeners' work. The record
 * stays joinable for the event's whole dispatch and is finalized at the
 * next task.
 */

const offs: Array<() => void> = [];
const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  for (const off of offs.splice(0)) off();
  attribution.disable();
  flush();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
  const records: InteractionEvent[] = [];
  offs.push(OBSERVE!.records.subscribe("interaction", e => records.push(e)));
  return records;
}

/** A document-level listener, the router's shape, removed after the test. */
function onDocument(name: string, listener: (e: Event) => void) {
  document.addEventListener(name, listener);
  cleanups.push(() => document.removeEventListener(name, listener));
}

function mount(code: () => any) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(code, container);
  cleanups.push(() => {
    dispose();
    container.remove();
  });
  flush();
  return container;
}

function click(el: Element) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** The task boundary after the dispatch: what finalizes the event's frame. */
function nextTask() {
  vi.advanceTimersByTime(1);
}

describe("one interaction frame per event (#3754)", () => {
  test("a click on an <a> in a root, joined by a document listener, is one record carrying its work", () => {
    const records = arm();
    const [location, setLocation] = createSignal("/", { name: "location" });
    const container = mount(() => {
      createEffect(location, () => {}, { name: "route" });
      return (
        <a id="go" href="/users/6">
          Go
        </a>
      );
    });
    onDocument("click", e =>
      dispatchAsInteraction(e, () => {
        e.preventDefault();
        setLocation("/users/6");
      })
    );

    click(container.querySelector("a")!);
    flush();
    nextTask();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      name: "click",
      target: 'a#go "Go"',
      writes: 1,
      outcome: "committed"
    });
    expect(location()).toBe("/users/6");
  });

  test("a runtime-attached document listener (addEvent) joins the delegated frame instead of opening a second", () => {
    const records = arm();
    const [location, setLocation] = createSignal("/", { name: "location" });
    const container = mount(() => {
      createEffect(location, () => {}, { name: "route" });
      return <a id="go">Go</a>;
    });
    const listener = addEvent(document as any, "click", () => setLocation("/next"), false);
    cleanups.push(() => document.removeEventListener("click", listener as EventListener));

    click(container.querySelector("a")!);
    flush();
    nextTask();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ target: 'a#go "Go"', writes: 1, outcome: "committed" });
  });

  test("onClick work and the outside listener's work land on the same record", () => {
    const records = arm();
    const [count, setCount] = createSignal(0, { name: "count" });
    const [location, setLocation] = createSignal("/", { name: "location" });
    const origins = new Set<unknown>();
    const container = mount(() => {
      createEffect(count, () => {}, { name: "counter" });
      createEffect(location, () => {}, { name: "route" });
      return (
        <a id="go" onClick={() => setCount(c => c + 1)}>
          Go
        </a>
      );
    });
    onDocument("click", e => dispatchAsInteraction(e, () => setLocation("/next")));
    offs.push(
      OBSERVE!.records.subscribe("rerun", r => {
        if (r.nodeName === "counter" || r.nodeName === "route") origins.add(r.interaction);
      })
    );

    click(container.querySelector("a")!);
    flush();
    nextTask();

    expect(records).toHaveLength(1);
    expect(records[0].writes).toBe(2);
    expect(records[0].outcome).toBe("committed");
    expect([...origins]).toEqual([records[0].origin]);
  });

  test("the record joins across a flush between listeners (the browser's microtask checkpoint)", () => {
    const records = arm();
    const [count, setCount] = createSignal(0, { name: "count" });
    const [location, setLocation] = createSignal("/", { name: "location" });
    const container = mount(() => {
      createEffect(count, () => {}, { name: "counter" });
      createEffect(location, () => {}, { name: "route" });
      return (
        <a id="go" onClick={() => setCount(c => c + 1)}>
          Go
        </a>
      );
    });
    // Native dispatch runs microtasks between listeners, so the onClick
    // write's drain commits before the document listener runs.
    const checkpoint = () => flush();
    document.body.addEventListener("click", checkpoint);
    cleanups.push(() => document.body.removeEventListener("click", checkpoint));
    onDocument("click", e => dispatchAsInteraction(e, () => setLocation("/next")));

    click(container.querySelector("a")!);
    flush();
    expect(records).toHaveLength(0);
    nextTask();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ writes: 2, outcome: "committed" });
  });

  test("separate events get separate frames", () => {
    const records = arm();
    const [location, setLocation] = createSignal("/", { name: "location" });
    const container = mount(() => {
      createEffect(location, () => {}, { name: "route" });
      return <a id="go">Go</a>;
    });
    let n = 0;
    onDocument("click", e => dispatchAsInteraction(e, () => setLocation(`/${++n}`)));
    const a = container.querySelector("a")!;

    click(a);
    flush();
    click(a);
    flush();
    nextTask();

    expect(records).toHaveLength(2);
    expect(records[0].origin).not.toBe(records[1].origin);
    expect(records.map(r => r.writes)).toEqual([1, 1]);
  });

  test("an idle event is recorded once, as idle", () => {
    const records = arm();
    const container = mount(() => (
      <a id="go" onClick={() => {}}>
        Go
      </a>
    ));
    onDocument("click", e => dispatchAsInteraction(e, () => {}));
    const listener = addEvent(document as any, "click", () => {}, false);
    cleanups.push(() => document.removeEventListener("click", listener as EventListener));

    click(container.querySelector("a")!);
    flush();
    nextTask();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ target: 'a#go "Go"', writes: 0, outcome: "idle" });
  });

  test("the record is finalized at the next task, not when the first listener returns", () => {
    const records = arm();
    const container = mount(() => <a id="go">Go</a>);

    click(container.querySelector("a")!);
    flush();
    expect(records).toHaveLength(0);
    expect(attribution.history("interaction")).toHaveLength(1);
    nextTask();
    expect(records).toHaveLength(1);
    expect(records[0].outcome).toBe("idle");
  });

  test("the same event dispatched again after its frame finalized opens a fresh frame", () => {
    const records = arm();
    const container = mount(() => <a id="go">Go</a>);
    const a = container.querySelector("a")!;
    const e = new MouseEvent("click", { bubbles: true });

    a.dispatchEvent(e);
    nextTask();
    a.dispatchEvent(e);
    nextTask();

    expect(records).toHaveLength(2);
    expect(records[0].origin).not.toBe(records[1].origin);
  });
});
