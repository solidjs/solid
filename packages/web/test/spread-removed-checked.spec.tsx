/** @jsxImportSource @solidjs/web */
import { describe, expect, test } from "vitest";
import { render } from "@solidjs/web";
import { createMemo, createSignal, flush, isPending, Loading } from "solid-js";

describe.each(["checkbox", "radio"] as const)("removed %s checked binding", type => {
  test.each(["click", "reset"] as const)("preserves selection after a %s", action => {
    const form = document.createElement("form");
    const [props, setProps] = createSignal<{ checked?: boolean; title: string }>({
      checked: true,
      title: "initial"
    });
    const inputProps = () => ({
      type,
      name: "choice",
      value: "primary",
      defaultChecked: true,
      ...props()
    });
    const dispose = render(
      () => (
        <>
          <input {...inputProps()} />
          {type === "radio" && <input type="radio" name="choice" value="other" />}
        </>
      ),
      form
    );
    const input = form.querySelector("input")!;
    const submittedChoice = () => new FormData(form).get("choice");

    try {
      expect(submittedChoice()).toBe("primary");

      setProps({ title: "removed" });
      flush();
      expect(input.checked).toBe(false);
      expect(submittedChoice()).toBeNull();

      if (action === "click") input.click();
      else form.reset();
      expect(submittedChoice()).toBe("primary");

      setProps({ title: "unrelated" });
      flush();
      expect(input.title).toBe("unrelated");
      expect(input.checked).toBe(true);
      expect(submittedChoice()).toBe("primary");

      setProps({ checked: false, title: "reintroduced" });
      flush();
      expect(input.checked).toBe(false);
      expect(submittedChoice()).toBeNull();
    } finally {
      dispose();
    }
  });
});

test("applies a reintroduced undefined checked binding during a held spread", async () => {
  const form = document.createElement("form");
  const [query, setQuery] = createSignal("");
  const [bound, setBound] = createSignal(true);
  let resolve!: (result: string) => void;

  const dispose = render(() => {
    const result = createMemo(() =>
      query()
        ? new Promise<string>(finish => {
            resolve = finish;
          })
        : "ready"
    );
    const inputProps = () => {
      const current = query();
      const pending = isPending(result);
      return {
        type: "checkbox" as const,
        name: "choice",
        title: pending ? "pending" : "ready",
        ...(bound() ? { checked: true } : pending || current ? { checked: undefined } : {})
      };
    };
    return (
      <>
        <input {...inputProps()} />
        <Loading fallback="loading">{result()}</Loading>
      </>
    );
  }, form);
  const input = form.querySelector("input")!;
  const submittedChoice = () => new FormData(form).get("choice");

  try {
    setBound(false);
    flush();
    expect(input.checked).toBe(false);
    input.click();
    expect(submittedChoice()).toBe("on");

    setQuery("wait");
    flush();
    expect(input.title).toBe("pending");
    expect(input.checked).toBe(false);
    expect(submittedChoice()).toBeNull();
  } finally {
    resolve?.("done");
    await new Promise(finish => setTimeout(finish, 0));
    dispose();
  }
});
