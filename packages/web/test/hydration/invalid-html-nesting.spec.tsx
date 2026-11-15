/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4875: the server writes the tree as the JSX nests it, and when that
// nesting is invalid HTML across a component boundary the browser's parser
// rebuilds it: a <div> closes an open <p>, an <a> closes an open <a>, a <tr>
// directly in a <table> gets an implied <tbody>, a <form> inside a <form> is
// dropped. Hydration keeps the parser's tree; dev names the cause
// (INVALID_HTML_NESTING, or the key-miss hint for a dropped <form>). The
// markup below is renderToString's output for each app.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { hydrate } from "@solidjs/web";
import { createSignal, flush, For } from "solid-js";

const container = document.createElement("div");
let dispose: (() => void) | undefined;
let warn: { mock: { calls: unknown[][] } };
beforeEach(() => {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  document.body.appendChild(container);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
  container.innerHTML = "";
  vi.restoreAllMocks();
});
const nesting = () =>
  warn.mock.calls.map(c => String(c[0])).filter(m => m.includes("[INVALID_HTML_NESTING]"));

const Row = (props: { v: string }) => (
  <tr>
    <td>{props.v}</td>
  </tr>
);

test("a <div> a component renders inside a <p> warns, naming where the parser put it", () => {
  const P = (props: { children: any }) => <p class="d">{props.children}</p>;
  const Badge = () => <div class="b">x</div>;
  container.innerHTML =
    '<section _hk=0><p _hk=1 class="d"><div _hk=20 class="b">x</div></p></section>';
  expect(container.querySelector("p")!.children.length).toBe(0);
  dispose = hydrate(
    () => (
      <section>
        <P>
          <Badge />
        </P>
      </section>
    ),
    container
  );
  flush();
  const msgs = nesting();
  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toContain("rendered <div> inside <p>");
  expect(msgs[0]).toContain("it now sits in <section>");
});

test("an <a> inside an <a> warns", () => {
  const A = (props: { children: any }) => <a href="/o">{props.children}</a>;
  const Inner = () => <a href="/i">in</a>;
  container.innerHTML =
    '<section _hk=0><a _hk=1 href="/o"><a _hk=20 href="/i">in</a></a></section>';
  dispose = hydrate(
    () => (
      <section>
        <A>
          <Inner />
        </A>
      </section>
    ),
    container
  );
  flush();
  expect(nesting()).toHaveLength(1);
  expect(nesting()[0]).toContain("rendered <a> inside <a>");
});

test("rows straight into a <table> warn once, naming the implied <tbody>", () => {
  const [rows] = createSignal(["a", "b"]);
  container.innerHTML =
    "<section _hk=0><table><tr _hk=100><td>a</td></tr><tr _hk=110><td>b</td></tr></table></section>";
  expect(container.querySelector("table")!.firstElementChild!.localName).toBe("tbody");
  dispose = hydrate(
    () => (
      <section>
        <table>
          <For each={rows()}>{v => <Row v={v} />}</For>
        </table>
      </section>
    ),
    container
  );
  flush();
  const msgs = nesting();
  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toContain("wrapped it in a <tbody> it added");
});

test("a <form> inside a <form> names the dropped form in the key miss", () => {
  const F = (props: { children: any }) => <form>{props.children}</form>;
  const G = () => (
    <form>
      <input name="n" />
    </form>
  );
  container.innerHTML =
    '<section _hk=0><form _hk=1><form _hk=20><input name="n"></form></form></section>';
  dispose = hydrate(
    () => (
      <section>
        <F>
          <G />
        </F>
      </section>
    ),
    container
  );
  flush();
  const miss = warn.mock.calls.map(c => String(c[0])).filter(m => m.includes("Hydration key miss"));
  expect(miss).toHaveLength(1);
  expect(miss[0]).toContain("forms cannot nest");
});

test("valid nesting and an explicit <tbody> hydrate, update and warn nothing", () => {
  const [rows, setRows] = createSignal(["a", "b"]);
  const Wrap = (props: { children: any }) => <div class="d">{props.children}</div>;
  container.innerHTML =
    '<section _hk=0><!--$--><div _hk=1 class="d"><p _hk=20>t</p></div><!--/--><table><tbody><tr _hk=300><td>a</td></tr><tr _hk=310><td>b</td></tr></tbody></table></section>';
  dispose = hydrate(
    () => (
      <section>
        <Wrap>
          <p>t</p>
        </Wrap>
        <table>
          <tbody>
            <For each={rows()}>{v => <Row v={v} />}</For>
          </tbody>
        </table>
      </section>
    ),
    container
  );
  flush();
  setRows(r => [...r.slice(1), "z"]);
  flush();
  expect(container.querySelector("tbody")!.textContent).toBe("bz");
  expect(nesting()).toEqual([]);
});
