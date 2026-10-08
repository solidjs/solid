/**
 * @jsxImportSource @solidjs/web
 */
// #3893: an aborted document cancels its serialized `sc:live` channel; the
// render's own end (`live.end()`, from the flush once the live source's hold
// releases) must not close it again. A second close throws from a microtask,
// which under plain Node is a process-level crash.
import { afterEach, describe, expect, test } from "vitest";
import { renderToStream } from "@solidjs/web";
import { createMemo } from "solid-js";
import { frameTransformDirectResult } from "../../frames/src/frame-sink.js";

const tick = () => new Promise(r => setTimeout(r));

const escaped: string[] = [];
const rejection = (e: unknown) => void escaped.push(`unhandledRejection: ${e}`);
const exception = (e: unknown) => void escaped.push(`uncaughtException: ${e}`);
afterEach(() => {
  process.off("unhandledRejection", rejection);
  process.off("uncaughtException", exception);
  escaped.length = 0;
});

describe("aborting a document with a live server component (#3893)", () => {
  test("the live channel is not closed twice after the abort", async () => {
    process.on("unhandledRejection", rejection);
    process.on("uncaughtException", exception);
    let release!: () => void;
    const pending = new Promise<void>(r => (release = r));
    async function* values() {
      yield 1;
      await pending;
    }
    const Inline = frameTransformDirectResult(
      () => {
        const v = createMemo(values);
        return <b>{v()}</b>;
      },
      { id: "minimal" }
    ) as any;

    const controller = new AbortController();
    let html = "";
    let firstWrite!: () => void;
    const wrote = new Promise<void>(r => (firstWrite = r));
    renderToStream(() => Inline(), { signal: controller.signal, onError() {} }).pipe({
      write(chunk: string) {
        html += chunk;
        firstWrite();
      },
      end() {}
    });
    await wrote;
    for (let i = 0; i < 3; i++) await tick();
    expect(html).toMatch(/1<!--lh:\/0--><\/b>/);

    controller.abort();
    release();
    for (let i = 0; i < 5; i++) await tick();
    expect(escaped).toEqual([]);
  });
});
