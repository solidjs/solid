/**
 * @jsxImportSource @solidjs/web
 *
 * #4240: a lone spread (`<label {...props()} />`) compiled to
 * `ssrElement(tag, props(), ...)`, so `props()` ran in argument position,
 * before `ssrElement` took the element's hydration key. A spread that
 * creates an owner (a memo) then took the element's id on the server only;
 * the client claims the key before applying the spread, so it missed the
 * element. A spread next to other attributes was already deferred behind a
 * thunk. Both shapes must give the element the same key.
 */
import { describe, expect, test } from "vitest";
import { createMemo, Show } from "solid-js";
import { renderToString } from "@solidjs/web";

const withMemo = () => {
  const title = createMemo(() => "spread");
  return {
    get title() {
      return title();
    }
  };
};

const labelKey = (html: string) => /<label[^>]*_hk="?([^"\s>]+)/.exec(html)?.[1];

describe("#4240 a lone spread runs after the element's hydration key", () => {
  test("a lone spread and a spread beside an attribute key the element the same", () => {
    const lone = renderToString(() => (
      <main>
        <Show when={true}>
          <label {...withMemo()}>lone spread</label>
        </Show>
      </main>
    ));
    const withAttribute = renderToString(() => (
      <main>
        <Show when={true}>
          <label data-x="" {...withMemo()}>
            lone spread
          </label>
        </Show>
      </main>
    ));
    expect(lone).toContain('title="spread"');
    expect(labelKey(lone)).toBeDefined();
    expect(labelKey(lone)).toBe(labelKey(withAttribute));
  });
});
