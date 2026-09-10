/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import {
  renderToString,
  renderToStream,
  Loading,
  Show,
  For,
  Repeat,
  Switch,
  Match,
  Dynamic,
  escape
} from "@solidjs/web";
import { createMemo } from "solid-js";

// SSR escaping contract: `escape(x)` at a template hole covers everything
// reachable from `x` — including what a function yields when the resolver
// finally calls it. The server flow controls return memos (hydration-id
// alignment with the client), so before the fix a string produced by one of
// them landed in the markup raw: `<Show when={s}>{s}</Show>` was an XSS.
// The fix is in `escape` alone (a deferred-escape wrapper), not in the flow
// controls, so these cases pin the resolver paths, not each control.
//
// Function-valued children are cast to `any`: the JSX types don't admit them,
// but the runtime reaches them (untyped props, `any`), which is exactly why
// their yield needs escaping coverage.

const XSS = `x <script>alert(1)</script> y & A > B "q"`;
const ESCAPED = `x &lt;script>alert(1)&lt;/script> y &amp; A > B "q"`;

function stripKeys(html: string): string {
  return html.replace(/ _hk=[^\s>]+/g, "").replace(/<!--\$-->|<!--\/-->/g, "");
}

function asyncValue<T>(value: T, ms = 5): Promise<T> {
  return new Promise(r => setTimeout(() => r(value), ms));
}

describe("SSR escaping of values a function yields", () => {
  test("string produced by a flow-control memo is escaped (the report)", () => {
    const Text = () => XSS;
    const cases: Array<[string, () => any]> = [
      [
        "direct component",
        () => (
          <div>
            <Text />
          </div>
        )
      ],
      [
        "Dynamic component",
        () => (
          <div>
            <Dynamic component={Text} />
          </div>
        )
      ],
      [
        "Show child",
        () => (
          <div>
            <Show when={true}>
              <Text />
            </Show>
          </div>
        )
      ],
      [
        "Show text child",
        () => (
          <div>
            <Show when={XSS}>{XSS}</Show>
          </div>
        )
      ],
      [
        "Show narrowed callback",
        () => (
          <div>
            <Show when={XSS}>{v => v()}</Show>
          </div>
        )
      ],
      [
        "Show keyed callback",
        () => (
          <div>
            <Show when={XSS} keyed>
              {v => v}
            </Show>
          </div>
        )
      ],
      [
        "Show fallback",
        () => (
          <div>
            <Show when={false} fallback={XSS}>
              never
            </Show>
          </div>
        )
      ],
      [
        "Switch/Match",
        () => (
          <div>
            <Switch>
              <Match when={true}>{XSS}</Match>
            </Switch>
          </div>
        )
      ],
      [
        "For bare row",
        () => (
          <div>
            <For each={[XSS]}>{v => v}</For>
          </div>
        )
      ],
      [
        "Repeat bare row",
        () => (
          <div>
            <Repeat count={1}>{() => XSS}</Repeat>
          </div>
        )
      ],
      [
        "Loading string child (insertion root)",
        () => (
          <div>
            <Loading>{XSS}</Loading>
          </div>
        )
      ],
      [
        "Loading memo child",
        () => (
          <div>
            <Loading>
              <Show when={true}>{XSS}</Show>
            </Loading>
          </div>
        )
      ],
      ["user memo child", () => <div>{createMemo(() => XSS) as any}</div>],
      ["thunk child", () => <div>{(() => XSS) as any}</div>],
      [
        "component returning a thunk",
        () => (
          <div>
            <Dynamic component={(() => () => XSS) as any} />
          </div>
        )
      ]
    ];
    for (const [name, code] of cases) {
      expect(stripKeys(renderToString(code)), name).toBe(`<div>${ESCAPED}</div>`);
    }
  });

  test("arrays a memo yields are escaped item-wise, nodes untouched", () => {
    const Rows = () => [XSS, <b>{XSS}</b>, 7, null, XSS];
    const html = stripKeys(
      renderToString(() => (
        <div>
          <Dynamic component={Rows} />
        </div>
      ))
    );
    expect(html).toBe(`<div>${ESCAPED}<b>${ESCAPED}</b>7${ESCAPED}</div>`);
  });

  test("top-level render of a bare string escapes", () => {
    expect(renderToString(() => XSS)).toBe(ESCAPED);
    expect(renderToString(() => <Show when={true}>{XSS}</Show>)).toBe(ESCAPED);
  });
});

describe("no double escaping", () => {
  test("template holes inside flow controls escape exactly once", () => {
    const s = "<b>&</b>";
    const once = "&lt;b>&amp;&lt;/b>";
    const cases: Array<[string, () => any]> = [
      [
        "element in Show",
        () => (
          <Show when={true}>
            <p>{s}</p>
          </Show>
        )
      ],
      [
        "thunk hole in element in Show",
        () => (
          <Show when={true}>
            <p>{(() => s) as any}</p>
          </Show>
        )
      ],
      [
        "nested Show",
        () => (
          <Show when={true}>
            <Show when={true}>{s}</Show>
          </Show>
        )
      ],
      [
        "Show in element in Show",
        () => (
          <Show when={true}>
            <p>
              <Show when={true}>{s}</Show>
            </p>
          </Show>
        )
      ],
      ["For rows with elements", () => <For each={[s]}>{v => <p>{v}</p>}</For>],
      [
        "For rows with nested For",
        () => <For each={[[s]]}>{row => <For each={row}>{v => v}</For>}</For>
      ],
      ["fragment from component", () => <Dynamic component={() => [s, <p>{s}</p>]} />],
      [
        "attribute in Show",
        () => (
          <Show when={true}>
            <p title={s}>{s}</p>
          </Show>
        )
      ],
      [
        "element in Loading",
        () => (
          <Loading>
            <p>{s}</p>
          </Loading>
        )
      ],
      [
        "Show in Loading",
        () => (
          <Loading>
            <Show when={true}>
              <p>{s}</p>
            </Show>
          </Loading>
        )
      ],
      ["passthrough component", () => <Dynamic component={(p: any) => p.children}>{s}</Dynamic>],
      [
        "passthrough component around Show",
        () => (
          <Dynamic component={(p: any) => <p>{p.children}</p>}>
            <Show when={true}>{s}</Show>
          </Dynamic>
        )
      ]
    ];
    for (const [name, code] of cases) {
      const html = stripKeys(renderToString(code));
      expect(html, name).toContain(once);
      expect(html, name).not.toContain("&amp;lt;");
      expect(html, name).not.toContain("&amp;amp;");
    }
  });

  test("escape() is idempotent on the deferred wrapper and leaves nodes alone", () => {
    const fn = () => "<i>";
    const w = escape(fn);
    expect(typeof w).toBe("function");
    expect(escape(w)).toBe(w);
    expect(w()).toBe("&lt;i>");
    const node = { t: "<i>" };
    expect(escape(node)).toBe(node);
    expect(escape(() => node)()).toBe(node);
    expect(escape(() => 5)()).toBe(5);
    expect(escape(() => null)()).toBe(null);
  });

  test("live-hole tags ride the wrapper; $slot survives the array copy", () => {
    const fn: any = () => ["<i>"];
    fn.$lhSkip = true;
    fn.$lhSuppress = true;
    const w: any = escape(fn);
    expect(w.$lhSkip).toBe(true);
    expect(w.$lhSuppress).toBe(true);
    const range: any = [{ t: "<!--slot:1:start-->" }, "<i>", { t: "<!--slot:1:end-->" }];
    range.$slot = true;
    const copy: any = escape(range);
    expect(copy).not.toBe(range);
    expect(copy.$slot).toBe(true);
    expect(copy[1]).toBe("&lt;i>");
  });
});

describe("streaming retries keep the deferred escape", () => {
  test("async string under a Loading boundary inside Show is escaped once", async () => {
    function Content() {
      const data = createMemo(async () => asyncValue(XSS));
      return <Show when={true}>{data()}</Show>;
    }
    const html = await renderToStream(() => (
      <div>
        <Loading fallback={XSS}>
          <Content />
        </Loading>
      </div>
    ));
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("&amp;lt;");
  });

  test("flow-control memo that suspends resolves escaped on retry", async () => {
    function App() {
      const data = createMemo(async () => asyncValue([XSS, XSS]));
      return (
        <div>
          <Loading fallback="loading">
            <For each={data()}>{v => v}</For>
          </Loading>
        </div>
      );
    }
    const html = await renderToStream(() => <App />);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html.split(ESCAPED).length - 1).toBe(2);
    expect(html).not.toContain("&amp;lt;");
  });
});
