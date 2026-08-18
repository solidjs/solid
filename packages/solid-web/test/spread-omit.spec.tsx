/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Client spread over omit() of a merge proxy (#3014). With a spread mixed
 * into other attributes the compiler emits spread(el, mergeProps(statics,
 * rest)); merge() used to flatten through omit()'s proxy via its hidden
 * $SOURCES read, so the omitted keys leaked — most damagingly an omitted
 * component-protocol handler (onChange) re-bound as a NATIVE listener that
 * fired with the raw Event instead of the component's value.
 */
import { describe, expect, test, vi } from "vitest";
import { render } from "@solidjs/web";
import { createSignal, flush, omit } from "solid-js";

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

describe("client spread respects omit() over a merge proxy (#3014)", () => {
  test("omitted attributes and handlers do not reach the element", () => {
    const container = document.createElement("div");
    const [value, setValue] = createSignal("a@b.c");
    const onChange = vi.fn((v: string) => setValue(v));
    const fieldProps = () => ({
      get value() {
        return value();
      },
      onChange
    });
    const dispose = render(
      () => (
        <Field label="Email address" name="email" placeholder="you@example.com" {...fieldProps()} />
      ),
      container
    );
    flush();
    const input = container.querySelector("input")!;
    // leaked attribute
    expect(input.getAttribute("label")).toBeNull();
    expect(input.getAttribute("placeholder")).toBe("you@example.com");
    // leaked native listener: a change event must not invoke the component
    // protocol handler with a raw Event
    input.dispatchEvent(new Event("change", { bubbles: true }));
    flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(value()).toBe("a@b.c");
    // the component's own wiring still works
    input.value = "x@y.z";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    expect(onChange).toHaveBeenCalledWith("x@y.z");
    expect(value()).toBe("x@y.z");
    dispose();
  });
});
