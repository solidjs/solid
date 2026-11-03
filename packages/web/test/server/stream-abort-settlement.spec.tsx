import { expect, test, vi } from "vitest";
import { createMemo, onCleanup } from "solid-js";
import { renderToStream, ssr, escape } from "@solidjs/web";
import { watchEscapes } from "./stream-settle-harness.js";

for (const timing of ["before render", "before then", "after then"] as const) {
  test(`rejects thenable consumers when aborted ${timing}`, async () => {
    const controller = new AbortController();
    const reason = { message: "request disconnected" };
    const onCompleteAll = vi.fn();
    if (timing === "before render") controller.abort(reason);
    const stream = renderToStream(() => "hello", {
      signal: controller.signal,
      onCompleteAll
    });
    if (timing === "before then") controller.abort(reason);
    const results: unknown[] = [];
    const fulfilled = vi.fn();
    stream.then(fulfilled, error => results.push(error));
    stream.then(fulfilled, error => results.push(error));
    if (timing === "after then") controller.abort(reason);
    await Promise.resolve();
    expect(results).toEqual([reason, reason]);
    expect(results[0]).toBe(reason);
    expect(results[1]).toBe(reason);
    expect(fulfilled).not.toHaveBeenCalled();
    expect(onCompleteAll).not.toHaveBeenCalled();
  });
}

test("rejects with the default abort reason", async () => {
  const controller = new AbortController();
  const stream = renderToStream(() => "hello", { signal: controller.signal });
  const rejected = vi.fn();
  stream.then(undefined, rejected);
  controller.abort();
  await Promise.resolve();
  expect(rejected).toHaveBeenCalledExactlyOnceWith(controller.signal.reason);
});

test("an abort after completion preserves the fulfilled result", async () => {
  const controller = new AbortController();
  const onCompleteAll = vi.fn();
  const stream = renderToStream(() => "hello", { signal: controller.signal, onCompleteAll });
  const result = Promise.resolve(stream);
  expect(await result).toBe("hello");
  controller.abort();
  expect(await result).toBe("hello");
  expect(onCompleteAll).toHaveBeenCalledTimes(1);
});

test("rejects while an asynchronous render is pending", async () => {
  const controller = new AbortController();
  const reason = new Error("client disconnected");
  let resolve!: (value: string) => void;
  const pending = new Promise<string>(done => (resolve = done));
  const onCompleteAll = vi.fn();
  const stream = renderToStream(
    () => {
      const message = createMemo(() => pending);
      return ssr(["<p>", "</p>"], () => escape(message()));
    },
    { signal: controller.signal, onCompleteAll }
  );
  const rejected = vi.fn();
  stream.then(undefined, rejected);
  controller.abort(reason);
  await Promise.resolve();
  expect(rejected).toHaveBeenCalledExactlyOnceWith(reason);
  resolve("loaded");
  await Promise.resolve();
  expect(onCompleteAll).not.toHaveBeenCalled();
});

test("rejects both consumers with the abort reason when cleanup throws without escaping", async () => {
  const controller = new AbortController();
  const reason = new Error("client disconnected");
  const cleanupError = new Error("cleanup threw");
  const onCompleteAll = vi.fn();
  const onError = vi.fn();
  const fulfilled = vi.fn();
  const rejected = [vi.fn(), vi.fn()];

  const escaped = await watchEscapes(async () => {
    const stream = renderToStream(
      () => {
        onCleanup(() => {
          throw cleanupError;
        });
        return "hello";
      },
      { signal: controller.signal, onCompleteAll, onError }
    );
    stream.then(fulfilled, rejected[0]);
    stream.then(fulfilled, rejected[1]);
    expect(() => controller.abort(reason)).not.toThrow();
    await Promise.resolve();
    for (const consumer of rejected) {
      expect(consumer).toHaveBeenCalledTimes(1);
      expect(consumer.mock.calls[0][0]).toBe(controller.signal.reason);
      expect(consumer.mock.calls[0][0]).toBe(reason);
    }
  });

  expect(escaped).toEqual([]);
  expect(fulfilled).not.toHaveBeenCalled();
  expect(onCompleteAll).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0]).toBe(cleanupError);
  expect(onError.mock.calls[0][1]).toMatchObject({ kind: "render", handling: "failed" });
});
