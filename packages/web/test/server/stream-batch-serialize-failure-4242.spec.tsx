/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4242: pending promises handed over before the shell batch
 * into one serializer write (the `$B` stub batch). Since seroval 1.7 a value
 * that fails to serialize ends the whole write it belongs to, so one async
 * value seroval cannot handle left every other value in its batch pending on
 * the client, Loading boundaries' `_fr` completion flags included, and the
 * page never finished hydrating. Writes remain isolated, but an async
 * serialization failure fails the render rather than reporting it complete
 * with a stranded key (#4647).
 */
import vm from "node:vm";
import { describe, expect, test } from "vitest";
import { getHydrationWriter, renderToStream } from "@solidjs/web";
import { createComponent, createMemo, Loading } from "solid-js";
import { pipeSettle, watchEscapes } from "./stream-settle-harness.js";

/** The hydration registry the page's scripts build, run as a browser would. */
function registry(html: string) {
  const sandbox: any = {
    document: { getElementById: () => null, addEventListener() {} },
    _$HY: { r: {}, fe() {} }
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const [, src] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(src, sandbox);
  }
  const r = sandbox._$HY.r as Record<string, any>;
  // A record that rejects on the client (a failed boundary's `_fr`, a
  // rejected source) needs a consumer, or it leaks an unhandled rejection.
  for (const k in r) if (r[k] && typeof r[k].then === "function") r[k].then(undefined, () => {});
  return r as Record<string, unknown>;
}

/** What a registry value settles to on the client, or "pending". */
function outcome(value: unknown) {
  return Promise.race([
    Promise.resolve(value).then(
      v => ({ fulfilled: v }),
      e => ({ rejected: e })
    ),
    new Promise(r => setTimeout(() => r("pending"), 50))
  ]);
}

/** A Loading boundary whose async memo resolves to `read()`'s value. */
function slot(read: () => unknown, fallback: string) {
  return createComponent(Loading, {
    fallback,
    get children() {
      const value = createMemo(async () => read());
      return [() => value()];
    }
  });
}

async function render(app: () => any) {
  const heard: unknown[] = [];
  let result: { state: string; html: string } | undefined;
  const escaped = await watchEscapes(async () => {
    result = await pipeSettle(app, { onError: e => void heard.push(e) });
  });
  expect(escaped).toEqual([]);
  expect(result!.state).toBe("settled");
  return { html: result!.html, heard, r: registry(result!.html) };
}

describe("renderToStream: a value that fails to serialize in the pre-shell batch (#4242)", () => {
  test("getHydrationWriter().write: a pre-shell failure fails the render", async () => {
    const { html, r, heard } = await render(() => {
      const writer = getHydrationWriter()!;
      writer.write(
        "lib:bad",
        Promise.resolve(() => 10)
      );
      writer.write("lib:fine", Promise.resolve("still here"));
      return <main>page</main>;
    });
    expect(heard.length).toBe(1);
    // Was: "lib:fine" fulfils and "lib:bad" stays pending (the rc.17
    // behaviour #4242 left alone). Ryan's ruling on #4647 (2026-11-03):
    // "failing ssr on failed serialization feels reasonable otherwise we
    // could be midstream". The bad value failed before the shell went out,
    // so the render fails and nothing ships. (Past the first flush its key
    // rejects on the client instead: stream-async-serialize-failure-4647.)
    expect(html).toBe("");
    expect(Object.keys(r)).toEqual([]);
  });

  test("an async memo resolving to a Loading boundary: both boundaries settle", async () => {
    // The outer memo's landing is an element, which the server now refuses
    // where it lands (ASYNC_MEMO_ELEMENT, async-memo-element-4242.spec.tsx):
    // the outer boundary's fragment rejects with the refusal instead of
    // leaving its value to the serializer. Nothing in the batch is stranded:
    // every completion flag settles, and the inner one still completes.
    const { r, heard } = await render(() =>
      slot(
        () => Promise.resolve(1).then(v => slot(async () => `nested-${v * 41}`, "inner")),
        "outer"
      )
    );
    expect(heard.map(e => String(e))).toEqual([expect.stringContaining("[ASYNC_MEMO_ELEMENT]")]);
    const flags = Object.keys(r).filter(k => k.endsWith("_fr"));
    expect(flags.length).toBe(2);
    const settled = await Promise.all(flags.map(key => outcome(r[key])));
    expect(settled).toEqual([
      {
        rejected: expect.objectContaining({
          message: expect.stringContaining("[ASYNC_MEMO_ELEMENT]")
        })
      },
      { fulfilled: true }
    ]);
  });

  test("a boundary rejecting with a value seroval cannot handle: the render fails before the shell", async () => {
    const { html, r, heard } = await render(() => [
      slot(() => Promise.reject(Object.assign(new Error("boom"), { retry: () => 1 })), "bad"),
      slot(async () => "fine", "fine")
    ]);
    // The rejection never reaches the client, so `0_fr` would stay pending
    // there forever: it failed before the first flush, so the render fails
    // instead (#4647; maintainer ruling, 2026-11-03), and nothing of the
    // document ships beside the key that cannot settle. The rejection
    // reaches two writes: each parses it and fails on its own, rather than
    // the second pointing at the slot the failed first one never filled.
    expect(heard.map(e => String(e))).toEqual([
      expect.stringContaining("cannot be parsed/serialized"),
      "Error: boom",
      expect.stringContaining("cannot be parsed/serialized")
    ]);
    expect(html).toBe("");
    expect(Object.keys(r)).toEqual([]);
  });
});
