/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createSignal, flush } from "solid-js";
import { assign, render, setProperty, spread } from "../src/client.js";

function createInput(type: string) {
  const form = document.createElement("form");
  const input = document.createElement("input");
  input.type = type;
  input.name = "choice";
  input.checked = true;
  form.appendChild(input);
  return { form, input };
}

function createWriter(method: "setProperty" | "assign") {
  const previous = {};
  return (node: Element, name: string, value: unknown) => {
    if (method === "setProperty") setProperty(node, name, value);
    else assign(node, { [name]: value }, true, previous);
  };
}

describe.each(["setProperty", "assign"] as const)("%s input values", method => {
  describe.each(["value", "defaultValue"] as const)("%s", name => {
    describe.each(["checkbox", "radio"])("%s", type => {
      test.each([undefined, null])("%s restores the default submission value", absent => {
        const { form, input } = createInput(type);
        const write = createWriter(method);

        // assign skips an initial undefined defaultValue; the transition below exercises it.
        write(input, name, absent);
        expect(input.getAttribute("value")).toBeNull();
        expect(input.value).toBe("on");
        expect(new FormData(form).get("choice")).toBe("on");

        write(input, name, "custom");
        expect(new FormData(form).get("choice")).toBe("custom");
        write(input, name, absent);
        expect(input.getAttribute("value")).toBeNull();
        expect(input.value).toBe("on");
        expect(new FormData(form).get("choice")).toBe("on");
      });

      test.each(["", "custom", 0])("preserves an explicit value of %j", value => {
        const { form, input } = createInput(type);
        const write = createWriter(method);
        write(input, name, value);
        expect(input.getAttribute("value")).toBe(String(value));
        expect(new FormData(form).get("choice")).toBe(String(value));
      });
    });

    test.each(["input", "textarea"])("still clears nullish values on %s", tag => {
      const element = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement;
      const write = createWriter(method);
      for (const absent of [undefined, null]) {
        write(element, name, "text");
        write(element, name, absent);
        expect(element[name]).toBe("");
      }
    });
  });
});

describe.each(["checkbox", "radio"])("reactive %s spread", type => {
  test.each(["value", "defaultValue"])(
    "removing %s restores the default submission value",
    name => {
      const { form, input } = createInput(type);
      const [props, setProps] = createSignal<Record<string, string | null | undefined>>({
        [name]: "custom"
      });
      const dispose = render(() => {
        spread(input, props);
        return input;
      }, form);

      try {
        expect(new FormData(form).get("choice")).toBe("custom");
        for (const next of [{ [name]: undefined }, { [name]: null }, {}]) {
          setProps(next);
          flush();
          expect(input.getAttribute("value")).toBeNull();
          expect(input.value).toBe("on");
          expect(new FormData(form).get("choice")).toBe("on");

          setProps({ [name]: "custom" });
          flush();
          expect(new FormData(form).get("choice")).toBe("custom");
        }
        setProps({ [name]: "" });
        flush();
        expect(new FormData(form).get("choice")).toBe("");
      } finally {
        dispose();
      }
    }
  );
});
