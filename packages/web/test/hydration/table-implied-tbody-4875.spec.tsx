/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4875: `<tr>` is not a child of `<table>` in HTML, so the parser moves
// server-rendered rows into a `<tbody>` it adds. An insert whose parent is
// the `<table>` then owns none of them, and the list stops updating after
// hydration. Dev names it (TABLE_ROWS_WITHOUT_TBODY); an explicit `<tbody>`
// hydrates and updates, and warns nothing.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { hydrate } from "@solidjs/web";
import { createSignal, flush, For } from "solid-js";

const container = document.createElement("div");
let dispose: (() => void) | undefined;
beforeEach(() => {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  document.body.appendChild(container);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
  container.innerHTML = "";
  vi.restoreAllMocks();
});
const tbodyWarnings = (warn: ReturnType<typeof vi.spyOn>) =>
  warn.mock.calls.map(c => String(c[0])).filter(m => m.includes("[TABLE_ROWS_WITHOUT_TBODY]"));

test("#4875 rows rendered straight into a <table> warn once at hydration", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const [rows] = createSignal(["a", "b"]);
  // As the server sends it; the parser adds the <tbody>.
  container.innerHTML =
    '<table _hk="0"><tr _hk="100"><td>a</td></tr><tr _hk="110"><td>b</td></tr></table>';
  expect(container.querySelector("table")!.firstElementChild!.localName).toBe("tbody");
  dispose = hydrate(
    () => (
      <table>
        <For each={rows()}>
          {r => (
            <tr>
              <td>{r}</td>
            </tr>
          )}
        </For>
      </table>
    ),
    container
  );
  flush();
  expect(tbodyWarnings(warn)).toHaveLength(1);
});

test("#4875 an explicit <tbody> hydrates, updates and does not warn", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const [rows, setRows] = createSignal(["a", "b"]);
  container.innerHTML =
    '<table _hk="0"><tbody><tr _hk="100"><td>a</td></tr><tr _hk="110"><td>b</td></tr></tbody></table>';
  dispose = hydrate(
    () => (
      <table>
        <tbody>
          <For each={rows()}>
            {r => (
              <tr>
                <td>{r}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    ),
    container
  );
  flush();
  setRows(r => [...r.slice(1), "z"]);
  flush();
  expect(container.querySelector("tbody")!.textContent).toBe("bz");
  expect(tbodyWarnings(warn)).toEqual([]);
});
