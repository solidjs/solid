/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Regression for #2884: an error thrown during initial render inside
// Loading + element + Show was fully swallowed — REACTIVITY_HALTED logged
// with no trace of the causing error. The Show memo's error propagated into
// the Loading tree as status, the boundary's foreign-status scrub (#2809)
// erased it, and the queue chain's unhandled verdict was ignored. The error
// must now surface: rethrown to the caller and logged with the halt message.

import { describe, expect, test, afterEach, vi } from "vitest";
import { Loading, Show, flush } from "solid-js";
import { render } from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("REACTIVITY_HALTED error visibility (#2884)", () => {
  test("an unhandled error under Loading + element + Show surfaces on initial load", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const div = document.createElement("div");

    const boom = (): string => {
      throw new Error("user boom");
    };

    let thrown: unknown = null;
    try {
      render(
        () => (
          <Loading fallback="Loading...">
            <div>
              <Show when={true}>Hello {boom()}</Show>
            </div>
          </Loading>
        ),
        div
      );
      flush();
    } catch (e) {
      thrown = e;
    }

    // The causing error is rethrown out of render...
    expect(String(thrown)).toContain("user boom");
    // ...and logged alongside the halt message.
    const haltCall = error.mock.calls.find(args => /REACTIVITY_HALTED/.test(String(args[0])));
    expect(haltCall).toBeDefined();
    expect(String(haltCall![1])).toContain("user boom");
  });
});
