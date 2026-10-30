/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4284 (async-gen E1): the compiler folds a template's attribute bindings
// into one effect. A binding whose first load is still in flight must not
// hide a later binding's error: grouped, reversed and split, the element
// shows the same thing (D-28: a read throws on its own; a throw ends the
// binding, not the bindings beside it).
import { describe, expect, test } from "vitest";
import { createMemo, Errored, Loading } from "solid-js";
import { render } from "../src/index.js";

const never = () => new Promise<string>(() => {});

describe("grouped attribute bindings read on their own (#4284)", () => {
  for (const shape of ["grouped", "reversed", "split"] as const)
    test(`${shape}: a pending binding does not hide an error`, () => {
      const div = document.createElement("div");
      const dispose = render(() => {
        const pending = createMemo(never);
        const broken = createMemo((): string => {
          throw new Error("boom");
        });
        return (
          <Errored fallback="[E]">
            <Loading fallback="[L]">
              {shape === "grouped" ? (
                <span title={pending()} data-x={broken()} />
              ) : shape === "reversed" ? (
                <span data-x={broken()} title={pending()} />
              ) : (
                <>
                  <span title={pending()} />
                  <span data-x={broken()} />
                </>
              )}
            </Loading>
          </Errored>
        );
      }, div);
      expect(div.innerHTML).toBe("[E]");
      dispose();
    });

  test("a pending binding still holds the bindings beside it", async () => {
    const div = document.createElement("div");
    let resolve!: (v: string) => void;
    const dispose = render(() => {
      const pending = createMemo(() => new Promise<string>(r => (resolve = r)));
      const ready = () => "ok";
      return (
        <Loading fallback="[L]">
          <span title={pending()} data-x={ready()} />
        </Loading>
      );
    }, div);
    expect(div.innerHTML).toBe("[L]");
    resolve("done");
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(div.innerHTML).toBe('<span title="done" data-x="ok"></span>');
    dispose();
  });
});
