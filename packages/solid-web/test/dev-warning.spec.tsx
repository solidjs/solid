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

  test("throws when async content rendered without Loading boundary", () => {
    div = document.createElement("div");
    document.body.appendChild(div);

    expect(() => {
      disposer = render(() => {
        const value = createMemo(() => new Promise<string>(() => {}));
        return <div>{value()}</div>;
      }, div);
    }).toThrow("Loading boundary");
  });

  test("no error when async content wrapped in Loading", () => {
    div = document.createElement("div");
    document.body.appendChild(div);

    expect(() => {
      disposer = render(() => {
        const value = createMemo(() => new Promise<string>(() => {}));
        return (
          <Loading fallback="loading">
            <div>{value()}</div>
          </Loading>
        );
      }, div);
    }).not.toThrow();
  });
});
