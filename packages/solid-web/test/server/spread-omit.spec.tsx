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
import { createSignal, omit } from "solid-js";

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
});
