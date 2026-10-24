/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4242: pending promises handed over before the shell batch
 * into one serializer write (the `$B` stub batch). Since seroval 1.7 a value
 * that fails to serialize ends the whole write it belongs to, so one async
 * value seroval cannot handle left every other value in its batch pending on
 * the client, Loading boundaries' `_fr` completion flags included, and the
 * page never finished hydrating. A failed value fails only its own key.
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
  test("getHydrationWriter().write: the other pending keys still resolve", async () => {
    const { r, heard } = await render(() => {
      const writer = getHydrationWriter()!;
      writer.write(
        "lib:bad",
        Promise.resolve(() => 10)
      );
      writer.write("lib:fine", Promise.resolve("still here"));
      return <main>page</main>;
    });
    expect(heard.length).toBe(1);
    expect(await outcome(r["lib:fine"])).toEqual({ fulfilled: "still here" });
    expect(await outcome(r["lib:bad"])).toBe("pending");
  });

  test("an async memo resolving to a Loading boundary: both boundaries complete", async () => {
    const { html, r, heard } = await render(() =>
      slot(
        () => Promise.resolve(1).then(v => slot(async () => `nested-${v * 41}`, "inner")),
        "outer"
      )
    );
    expect(heard.length).toBe(1);
    expect(html.startsWith("nested-41")).toBe(true);
    const flags = Object.keys(r).filter(k => k.endsWith("_fr"));
    expect(flags.length).toBe(2);
    for (const key of flags) expect(await outcome(r[key])).toEqual({ fulfilled: true });
  });

  test("a boundary rejecting with a value seroval cannot handle: its siblings still complete", async () => {
    const { r } = await render(() => [
      slot(() => Promise.reject(Object.assign(new Error("boom"), { retry: () => 1 })), "bad"),
      slot(async () => "fine", "fine")
    ]);
    expect(Object.keys(r).filter(k => k.endsWith("_fr"))).toEqual(["0_fr", "1_fr"]);
    expect(await outcome(r["1_fr"])).toEqual({ fulfilled: true });
  });
});
