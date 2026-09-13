/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 *
 * The client half of the trace context is a stub: the trace a request
 * belongs to is a server-side reading, and the browser SDK that continues
 * it reads the document's `<meta>` / `Server-Timing` itself. `getRequestEvent`
 * has the same shape on this entry.
 */
import { describe, expect, test } from "vitest";
import { getTraceContext, getRequestEvent } from "../src/index.js";

describe("getTraceContext (client entry)", () => {
  test("answers undefined, quietly, like getRequestEvent", () => {
    expect(getTraceContext()).toBeUndefined();
    expect(getRequestEvent()).toBeUndefined();
  });
});
