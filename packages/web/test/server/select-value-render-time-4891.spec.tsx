/**
 * @jsxImportSource @solidjs/web
 *
 * #4891: a bound `<select value>` marks its option `selected` while it
 * renders, not in a pass over the finished html. The select's value rides
 * its owner, so options a `<For>`, a component or a later async pass
 * renders find it, concurrent renders keep their own values, and a render
 * with no select does no select work at all.
 */
import { describe, expect, test } from "vitest";
import { renderToString, renderToStream, Loading } from "@solidjs/web";
import { For, Show, createMemo, createSignal } from "solid-js";

function later<T>(value: T, ms = 5): Promise<T> {
  return new Promise(r => setTimeout(() => r(value), ms));
}

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

const selected = (html: string) =>
  [...html.matchAll(/<option([^>]*)>/g)]
    .filter(m => /\sselected(?=[\s>=]|$)/.test(m[1]))
    .map(m => /value="([^"]*)"/.exec(m[1])?.[1] ?? "(text)");

describe("SSR <select value> at render time (#4891)", () => {
  test("options from a <For> match the select's value", () => {
    const [v] = createSignal("b");
    const html = renderToString(() => (
      <select value={v()}>
        <For each={["a", "b", "c"]}>{o => <option value={o}>{o}</option>}</For>
      </select>
    ));
    expect(selected(html)).toEqual(["b"]);
    expect(html).not.toMatch(/<select[^>]*value/);
  });

  test("options from a component and a <Show> match", () => {
    const Opt = (props: { v: string }) => <option value={props.v}>{props.v}</option>;
    const html = renderToString(() => (
      <select value="c">
        <Opt v="a" />
        <Show when={true}>
          <option value="c">c</option>
        </Show>
        <optgroup label="g">
          <Opt v="d" />
        </optgroup>
      </select>
    ));
    expect(selected(html)).toEqual(["c"]);
  });

  test("an option's text is its value when it has no value attribute", () => {
    const [label] = createSignal("Two");
    const html = renderToString(() => (
      <select value="Two">
        <option>One</option>
        <option>{label()}</option>
        <option>{"  Three  "}</option>
      </select>
    ));
    expect(html).toMatch(/<option selected>Two<\/option>/);
    expect(html).toMatch(/<option>One<\/option>/);
  });

  test("a multiple select's array value marks every matching option", () => {
    const html = renderToString(() => (
      <select multiple value={["a", 3] as string[]}>
        <option value="a">a</option>
        <option value="b">b</option>
        <option value={3}>3</option>
      </select>
    ));
    expect(selected(html)).toEqual(["a", "3"]);
  });

  test("an option carrying `selected` itself is the default and later matches stay off", () => {
    const html = renderToString(() => (
      <select value="b">
        <option value="a" selected>
          a
        </option>
        <option value="b">b</option>
      </select>
    ));
    expect(selected(html)).toEqual(["a"]);
  });

  test("an option outside any bound select is never marked", () => {
    const html = renderToString(() => (
      <div>
        <select>
          <option value="a">a</option>
        </select>
        <datalist>
          <option value="a">a</option>
        </datalist>
      </div>
    ));
    expect(selected(html)).toEqual([]);
  });

  test("options under a Loading inside the select match when they stream in", async () => {
    const list = later(["x", "y", "z"]);
    const Options = () => {
      const items = createMemo(() => list);
      return <For each={items()}>{o => <option value={o}>{o}</option>}</For>;
    };
    const html = await renderComplete(() => (
      <select value="y">
        <option value="">none</option>
        <Loading fallback={<option value="..">loading</option>}>
          <Options />
        </Loading>
      </select>
    ));
    expect(selected(html)).toEqual(["y"]);
  });

  test("an async select value waits and still marks its options", async () => {
    const value = later("z");
    const Picker = () => {
      const v = createMemo(() => value);
      return (
        <select value={v()}>
          <For each={["x", "y", "z"]}>{o => <option value={o}>{o}</option>}</For>
        </select>
      );
    };
    const html = await renderComplete(() => (
      <Loading fallback={<p>loading</p>}>
        <Picker />
      </Loading>
    ));
    expect(selected(html)).toEqual(["z"]);
  });

  test("concurrent streamed renders keep their own select values", async () => {
    const page = (value: string, ms: number) => {
      const list = later(["a", "b", "c"], ms);
      const Options = () => {
        const items = createMemo(() => list);
        return <For each={items()}>{o => <option value={o}>{o}</option>}</For>;
      };
      return () => (
        <select value={value}>
          <Loading fallback={<option>loading</option>}>
            <Options />
          </Loading>
        </select>
      );
    };
    const [one, two] = await Promise.all([
      renderComplete(page("a", 10)),
      renderComplete(page("c", 2))
    ]);
    expect(selected(one)).toEqual(["a"]);
    expect(selected(two)).toEqual(["c"]);
  });

  test("a spread select and spread options match", () => {
    const props = { value: "b", name: "s" };
    const opt = (v: string) => ({ value: v });
    const html = renderToString(() => (
      <select {...props}>
        <option {...opt("a")}>a</option>
        <option {...opt("b")}>b</option>
        <For each={["c"]}>{o => <option value={o}>{o}</option>}</For>
      </select>
    ));
    expect(selected(html)).toEqual(["b"]);
    expect(html).not.toMatch(/<select[^>]*value/);
    expect(html).toMatch(/<select[^>]* name="s"/);
  });

  test("an escaped value matches its option", () => {
    const html = renderToString(() => (
      <select value={'a&b"<'}>
        <option value="x">x</option>
        <option value={'a&b"<'}>amp</option>
      </select>
    ));
    expect(selected(html)).toEqual(["a&amp;b&quot;&lt;"]);
  });
});
