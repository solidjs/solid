/**
 * @jsxImportSource @solidjs/web
 *
 * Output invariants for a spread element with static attributes
 * (test/harness/spread-static-tail.tsx). The three forms are compiled
 * differently — the tail form's statics become `ssrElement`'s attribute
 * string, the head form's stay a source — but they must serialize the same
 * attribute set, and a key the spread and the statics both carry must
 * resolve the way JSX order says: the later one wins, the loser unread.
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";
import { createMemo } from "solid-js";
import {
  collidingReads,
  collidingRows,
  forms,
  List,
  makeRows,
  resetCollidingReads,
  type Row
} from "../harness/spread-static-tail.jsx";

function render(form: keyof typeof forms, rows: Row[]) {
  return renderToString(() => <List rows={rows} render={forms[form]} />);
}

/** Attribute name→value maps of every `<li …>` in the markup, `_hk` dropped. */
function liAttrs(html: string): Record<string, string>[] {
  return [...html.matchAll(/<li\s([^>]*)>/g)].map(m => {
    const out: Record<string, string> = {};
    for (const a of m[1].matchAll(/([^\s=]+)(?:=(?:"([^"]*)"|([^\s>]+)))?/g))
      if (a[1] !== "_hk") out[a[1]] = a[2] ?? a[3] ?? "";
    return out;
  });
}

describe("spread element with static attributes — SSR", () => {
  test("tail and head forms serialize the same attribute set", () => {
    const rows = makeRows(3);
    const tail = liAttrs(render("tail", rows));
    const head = liAttrs(render("head", rows));
    expect(tail).toHaveLength(3);
    expect(tail).toEqual(head);
    expect(tail[1]).toEqual({
      id: "row-1",
      title: "Row 1",
      "aria-posinset": "2",
      class: "row",
      "data-kind": "item"
    });
  });

  test("each element carries one hydration key and its text child", () => {
    const html = render("tail", makeRows(2));
    expect(html.match(/<li _hk=/g)).toHaveLength(2);
    expect(html.match(/_hk=/g)).toHaveLength(3); // ul + 2 li
    expect(html).toContain(">Row 0</li>");
    expect(html).toContain(">Row 1</li>");
  });

  test("a static after the spread wins over the spread's key, which is never read", () => {
    resetCollidingReads();
    const attrs = liAttrs(render("tail", collidingRows(2)));
    expect(attrs.map(a => a.class)).toEqual(["row", "row"]);
    expect(collidingReads).toBe(0);
    // no attribute emitted twice
    for (const a of attrs) expect(Object.keys(a).filter(k => k === "class")).toHaveLength(1);
  });

  test("a static before the spread loses to the spread's key", () => {
    resetCollidingReads();
    const attrs = liAttrs(render("head", collidingRows(2)));
    expect(attrs.map(a => a.class)).toEqual(["from-spread", "from-spread"]);
    expect(collidingReads).toBe(2);
  });

  test("mixed tail: the static is fixed, the dynamic reads live, the spread's copy is skipped", () => {
    resetCollidingReads();
    const rows = collidingRows(2);
    const attrs = liAttrs(render("mixed", rows));
    expect(attrs[0]).toEqual({
      id: "row-0",
      title: "Row 0",
      "aria-posinset": "1",
      class: "row",
      "data-id": "r0"
    });
    expect(attrs[1]["data-id"]).toBe("r1");
    expect(collidingReads).toBe(0);
  });

  test("content-bearing statics after the spread stay content, not attributes", () => {
    const rest = { id: "a", title: "t" };
    // A textarea's value is its text content on the server; innerHTML is the
    // element's content. Neither is markup in the attribute string.
    const textarea = renderToString(() => <textarea {...rest} value="typed text" />);
    expect(textarea).toMatch(/^<textarea _hk=\S+ id="a" title="t">typed text<\/textarea>$/);
    const html = renderToString(() => <div {...rest} innerHTML="<b>x</b>" class="c" />);
    expect(html).toMatch(/^<div _hk=\S+ id="a" title="t" class="c"><b>x<\/b><\/div>$/);
  });

  test("literal statics after the spread: bare, true, false, number, escaped string", () => {
    const rest = { id: "a", hidden: true, tabindex: 9, title: "from-spread" };
    const html = renderToString(() => (
      <input
        {...rest}
        disabled
        hidden={false}
        tabindex={0}
        title={'say "hi" & <bye>'}
        type="text"
      />
    ));
    expect(html).toMatch(
      /^<input _hk=\S+ id="a" disabled tabindex="0" title="say &quot;hi&quot; &amp; &lt;bye>" type="text" \/>$/
    );
  });

  test("a dynamic tail keeps its place in the hydration-id sequence", () => {
    // The tail thunk runs after the element's key, after the spread, before
    // the children — where the trailing source's getter used to be read. An
    // expression that allocates ids there (a server memo) must leave every
    // sibling after it with the same key as the getter form (dynhead), and
    // as the same element written without a spread at all.
    const rest = { id: "a" };
    const dyn = () => createMemo(() => "m")();
    // Fragment children are hydration roots, so every sibling carries a key.
    const tail = renderToString(() => (
      <>
        <li {...rest} class="row" data-id={dyn()}>
          x
        </li>
        <li>after</li>
        <span>{dyn()}</span>
      </>
    ));
    const getter = renderToString(() => (
      <>
        <li data-id={dyn()} class="row" {...rest}>
          x
        </li>
        <li>after</li>
        <span>{dyn()}</span>
      </>
    ));
    const template = renderToString(() => (
      <>
        <li id="a" data-id={dyn()} class="row">
          x
        </li>
        <li>after</li>
        <span>{dyn()}</span>
      </>
    ));
    const keys = (html: string) => [...html.matchAll(/_hk=(\S+?)[\s>]/g)].map(m => m[1]);
    expect(keys(tail)).toEqual(keys(getter));
    expect(keys(tail)).toEqual(keys(template));
    expect(tail).toContain('data-id="m"');
    // the memo took an id between the element and its next sibling
    expect(keys(tail)).toEqual(["0", "2", "3"]);
  });

  test("no attribute is emitted twice in any form", () => {
    for (const form of Object.keys(forms) as Array<keyof typeof forms>) {
      const html = render(form, collidingRows(1));
      const names = [...html.match(/<li\s([^>]*)>/)![1].matchAll(/(?:^|\s)([^\s=]+)/g)].map(
        m => m[1]
      );
      expect(new Set(names).size, `${form}: ${html}`).toBe(names.length);
    }
  });
});
