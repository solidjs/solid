/**
 * @jsxImportSource @solidjs/web
 *
 * SSR spread over omit() of a merge proxy (#3014). merge() flattens nested
 * merges via a hidden $SOURCES read; omit()'s forwarding proxy used to tunnel
 * that read through to the underlying merge proxy's UNFILTERED sources, so the
 * compiler's element-spread re-merge (ssrElement receives
 * mergeProps(statics, rest)) leaked the omitted keys into the HTML.
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";
import { createSignal, merge, omit } from "solid-js";
import { viewOf, type MergeView, type OmitView } from "solid-js/internal";

function Field(
  props: {
    name: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
  } & Record<string, unknown>
) {
  const rest = omit(props, "name", "label", "value", "onChange");
  return (
    <label>
      {props.label}
      <input
        name={props.name}
        value={props.value}
        onInput={e => props.onChange(e.currentTarget.value)}
        {...rest}
      />
    </label>
  );
}

describe("SSR spread respects omit() over a merge proxy (#3014)", () => {
  test("omitted keys stay out of the HTML; pass-through keys remain", () => {
    const [value] = createSignal("a@b.c");
    // The dynamic call-site spread is what makes the callee's props a merge proxy.
    const fieldProps = () => ({
      get value() {
        return value();
      },
      onChange: (_v: string) => {}
    });
    const html = renderToString(() => (
      <Field label="Email address" name="email" placeholder="you@example.com" {...fieldProps()} />
    ));
    // component-handled keys must not leak onto the input
    expect(html).not.toContain("label=");
    expect(html).not.toContain("onChange");
    // statics and pass-through attributes still render
    expect(html).toMatch(/<input[^>]*name="email"/);
    expect(html).toMatch(/<input[^>]*value="a@b\.c"/);
    expect(html).toMatch(/<input[^>]*placeholder="you@example\.com"/);
    // the label text still renders as content
    expect(html).toContain("Email address");
  });

  test("the element walks the view's entries; it builds no resolved table", () => {
    // A spread is one pass over each key, and the view is gone after it, so
    // serializing must not pay for the key table a long-lived client view
    // would (the Kobalte-shaped chain profile). Both view shapes an element can receive:
    // an omit over a merge (filtered leaf entries) and a bare merge.
    let rest: any, merged: any;
    const html = renderToString(() => {
      merged = merge({ type: "button", as: "button" }, { as: "a", class: "btn", href: "#x" });
      rest = omit(merged, "type", "as");
      return (
        <>
          <a {...rest} />
          <span {...merged} />
        </>
      );
    });
    expect(html).toContain('<a _hk=0 class="btn" href="#x"></a>');
    // The merge's own `as` is shadowed by the later source and sits at that
    // source's position (the merged order); `type` is a data attribute the
    // span happily carries.
    expect(html).toContain('<span _hk=1 type="button" as="a" class="btn" href="#x"></span>');
    expect((viewOf(rest) as OmitView).table).toBe(0);
    expect((viewOf(merged) as MergeView).table).toBe(0);
  });
});
