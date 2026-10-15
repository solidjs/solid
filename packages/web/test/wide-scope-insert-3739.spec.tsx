/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #3739: the insert's child-resolution pass tracks each row's resolved child
// by construction — a `<For>` of conditional rows, or of HMR-wrapped
// components in dev — so WIDE_SCOPE_DEPS does not judge it. HUGE_FAN_IN, the
// always-on backstop, still does.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "@solidjs/web";
import { createComponent, createMemo, createStore, flush, For, OBSERVE, Show } from "solid-js";
import type { DiagnosticEvent } from "solid-js";
import { attribution } from "solid-js/attribution";
import { $$component, $$registry } from "solid-js/refresh";

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function capture(codes: string[]) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const events: DiagnosticEvent[] = [];
  disposers.push(
    OBSERVE!.diagnostics.subscribe(e => {
      if (codes.includes(e.code)) events.push(e);
    })
  );
  return events;
}

function mount(code: () => any) {
  const ul = document.createElement("ul");
  disposers.push(render(code, ul));
  flush();
  return ul;
}

function rows(n: number) {
  return createStore(Array.from({ length: n }, (_, i) => ({ id: `r${i}`, open: true })))[0];
}

describe("WIDE_SCOPE_DEPS and the insert's child-resolution pass", () => {
  // wideDeps 30, the old default: the exemption, not the new threshold, is
  // what keeps these quiet.
  test("a <For> of 40 <Show> rows does not warn", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false, wideDeps: 30 });
    const list = rows(40);
    const ul = mount(() => (
      <For each={list}>
        {row => (
          <Show when={row.open}>
            <li />
          </Show>
        )}
      </For>
    ));
    expect(ul.childElementCount).toBe(40);
    expect(events).toEqual([]);
  });

  test("a dev HMR-wrapped <For> of 40 components does not warn", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false, wideDeps: 30 });
    const Row = $$component($$registry(), "Row", () => <li />);
    const list = rows(40);
    const ul = mount(() => <For each={list}>{() => createComponent(Row, {})}</For>);
    expect(ul.childElementCount).toBe(40);
    expect(events).toEqual([]);
  });

  test("HMR plumbing is not counted for a user memo resolving the rows either", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false, wideDeps: 30 });
    const Row = $$component($$registry(), "Row", () => <li />);
    const ul = mount(() => {
      const items = Array.from({ length: 40 }, () => createComponent(Row, {}) as any);
      const resolved = createMemo(() => items.map(item => item()), { name: "resolved" });
      return <>{resolved()}</>;
    });
    expect(ul.childElementCount).toBe(40);
    expect(events).toEqual([]);
  });

  test("HUGE_FAN_IN still fires past 2000 rows through the insert", () => {
    const events = capture(["HUGE_FAN_IN", "WIDE_SCOPE_DEPS"]);
    const list = rows(2001);
    const ul = mount(() => (
      <For each={list}>
        {row => (
          <Show when={row.open}>
            <li />
          </Show>
        )}
      </For>
    ));
    expect(ul.childElementCount).toBe(2001);
    expect(events.map(e => e.code)).toEqual(["HUGE_FAN_IN"]);
  });
});
