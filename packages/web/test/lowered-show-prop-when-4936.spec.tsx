/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4936: a `<Show>` whose `when` is a prop and whose callback renders the
 * value. Lowered to a ternary (production builds, the `LOWER_SHOW=1` CI job),
 * the callback's `child()` was written as `props.children` again, and each
 * read of a JSX prop makes its JSX anew: the child was created twice and
 * hydration handed its key to the wrong copy. A prop `when` now keeps the
 * component under a callback, so the child is made once, by `when`'s read.
 */
import { describe, expect, test } from "vitest";
import { createSignal, flush, Show } from "solid-js";
import { render } from "@solidjs/web";

describe("#4936: a prop `when` read by a Show callback", () => {
  test("a JSX child is made once and is the node rendered", () => {
    let made = 0;
    let node!: HTMLSpanElement;
    const Child = () => {
      made++;
      return (node = (<span>child</span>) as HTMLSpanElement);
    };
    function Optional(props: { children?: any }) {
      return (
        <div class="optional">
          <Show when={props.children}>{child => <p>{child()}</p>}</Show>
        </div>
      );
    }
    const root = document.createElement("div");
    const dispose = render(
      () => (
        <Optional>
          <Child />
        </Optional>
      ),
      root
    );
    flush();
    expect(made).toBe(1);
    expect(root.querySelector("p")!.firstChild).toBe(node);
    expect(root.innerHTML).toBe('<div class="optional"><p><span>child</span></p></div>');
    dispose();
  });

  test("a prop getter that runs code is read once per change", () => {
    let reads = 0;
    const [name, setName] = createSignal("a");
    function Card(props: { user?: { name: string } }) {
      return <Show when={props.user}>{u => <b>{u().name}</b>}</Show>;
    }
    const root = document.createElement("div");
    const dispose = render(
      () => (
        <Card
          user={(() => {
            reads++;
            return { name: name() };
          })()}
        />
      ),
      root
    );
    flush();
    expect(root.innerHTML).toBe("<b>a</b>");
    const first = reads;
    setName("b");
    flush();
    expect(root.innerHTML).toBe("<b>b</b>");
    // One read of the prop per change, by `when`: the callback reads `u()`,
    // not the prop again.
    expect(reads - first).toBe(1);
    dispose();
  });
});
