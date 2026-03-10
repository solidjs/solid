/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import { createSignal, createMemo, Loading, flush } from "solid-js";
import { render } from "../src/index.js";

describe("Dev-mode async error", () => {
  let div: HTMLDivElement;
  let disposer: (() => void) | undefined;

  afterEach(() => {
    if (disposer) {
      disposer();
      disposer = undefined;
    }
    div?.remove();
  });

  test("unmounts and shows error when async content rendered without Loading boundary", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    div = document.createElement("div");
    document.body.appendChild(div);

    disposer = render(() => {
      const value = createMemo(() => new Promise<string>(() => {}));
      return <div>{value()}</div>;
    }, div);

    expect(div.querySelector("pre")).not.toBeNull();
    expect(div.textContent).toContain("without a <Loading> boundary");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("<Loading>"));
    error.mockRestore();
  });

  test("no error when async content wrapped in Loading", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    div = document.createElement("div");
    document.body.appendChild(div);

    disposer = render(() => {
      const value = createMemo(() => new Promise<string>(() => {}));
      return (
        <Loading fallback="loading">
          <div>{value()}</div>
        </Loading>
      );
    }, div);

    expect(div.querySelector("pre")).toBeNull();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
