import { expect, test, vi, beforeEach, afterAll } from "vitest";
import { renderToString, renderToStringAsync, renderToStream } from "../src/server-mock.js";

const origConsoleError = console.error;
const mockConsoleError = vi.fn();

beforeEach(() => {
  console.error = mockConsoleError;
  mockConsoleError.mockReset();
});

afterAll(() => {
  console.error = origConsoleError;
});

test("renderToString", () => {
  const result = renderToString(() => {});

  const err: Error = mockConsoleError.mock.calls[0][0];

  expect(err.message).toContain(
    "renderToString is not supported in the browser, returning undefined"
  );
  expect(result).toBeUndefined();
});

test("renderToStringAsync", () => {
  const result = renderToStringAsync(() => {});

  const err: Error = mockConsoleError.mock.calls[0][0];

  expect(err.message).toContain(
    "renderToStringAsync is not supported in the browser, returning undefined"
  );
  expect(result).toBeUndefined();
});

test("renderToStream", () => {
  const result = renderToStream(() => {});

  const err: Error = mockConsoleError.mock.calls[0][0];

  expect(err.message).toContain(
    "renderToStream is not supported in the browser, returning undefined"
  );
  expect(result).toBeUndefined();
});
