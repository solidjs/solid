/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4647: an async value that resolves to something seroval
 * cannot serialize. The failure is heard as `render/serialize` and the
 * render completes with the content it rendered (by design, #4227), but the
 * payload declared the key's promise and never settled it: the client's read
 * stayed pending forever. Ryan's ruling (2026-11-03): the key rejects on the
 * client, with an error that says it is a serialization failure and names
 * the key, so the reading computation throws into the nearest `<Errored>`
 * (the hydration side is errored-unserializable-hydration-4647.spec.tsx).
 */
import vm from "node:vm";
import { describe, expect, test } from "vitest";
import { renderToStream, type ServerErrorContext } from "@solidjs/web";
import { createMemo, Loading } from "solid-js";
import { settle, watchEscapes } from "./stream-settle-harness.js";

class Unserializable {}

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
  for (const k in r) if (r[k] && typeof r[k].then === "function") r[k].then(undefined, () => {});
  return r;
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

const serializeFailure = (key: string) => ({
  rejected: expect.objectContaining({
    message:
      `Serialization failed: the hydration value for key "${key}" ` +
      "could not be serialized on the server"
  })
});

async function render(app: () => any, options: { renderId?: string } = {}) {
  const heard: string[] = [];
  let completed = false;
  let result: { state: string; html: string } | undefined;
  const escaped = await watchEscapes(async () => {
    result = await settle(
      renderToStream(app, {
        ...options,
        onError: (e: any, c: ServerErrorContext) =>
          void heard.push(`${e?.constructor?.name}/${c.kind}/${c.handling}`),
        onCompleteAll: () => void (completed = true)
      })
    );
  });
  expect(escaped).toEqual([]);
  expect(result!.state).toBe("settled");
  return { html: result!.html, heard, completed, r: registry(result!.html) };
}

function Page(props: { make: () => Promise<unknown> }) {
  const value = createMemo(props.make);
  return <main>{String(value() instanceof Unserializable || value())}</main>;
}

describe("renderToStream: an async value that resolves to something unserializable (#4647)", () => {
  test("control: a serializable value fulfils the key", async () => {
    const { completed, heard, r } = await render(() => (
      <Page make={() => Promise.resolve("loaded")} />
    ));
    expect(completed).toBe(true);
    expect(heard).toEqual([]);
    expect(await outcome(r["0"])).toEqual({ fulfilled: "loaded" });
  });

  test("the render completes, and the key rejects with a serialization error naming it", async () => {
    const { html, completed, heard, r } = await render(() => (
      <Page make={() => Promise.resolve(new Unserializable())} />
    ));
    expect(html).toContain(">true</main>");
    expect(completed).toBe(true);
    expect(heard).toEqual(["SerovalUnsupportedTypeError/render/serialize"]);
    const settled = await outcome(r["0"]);
    expect(settled).toEqual(serializeFailure("0"));
    // The failure's own text stays on the server (it went to the hook).
    expect(String((settled as any).rejected.message)).not.toContain("Unsupported");
    // Unmarked (no `s`), so the hydrating read takes the rejection after the
    // claim pass and the Errored's fallback replaces the server's content.
    expect((r["0"] as any).s).toBeUndefined();
  });

  test("under a renderId scope", async () => {
    const { r } = await render(() => <Page make={() => Promise.resolve(new Unserializable())} />, {
      renderId: "app-"
    });
    const keys = Object.keys(r);
    expect(keys.length).toBe(1);
    expect(await outcome(r[keys[0]])).toEqual(serializeFailure(keys[0]));
  });

  test("a value that lands after the shell, inside a Loading boundary", async () => {
    const { html, completed, r } = await render(() => (
      <Loading fallback="loading">
        <Page make={() => new Promise(res => setTimeout(() => res(new Unserializable()), 20))} />
      </Loading>
    ));
    expect(completed).toBe(true);
    expect(html).toContain(">true</main>");
    const keys = Object.keys(r).filter(k => !k.endsWith("_fr") && !k.endsWith("_assets"));
    expect(keys.length).toBe(1);
    expect(await outcome(r[keys[0]])).toEqual(serializeFailure(keys[0]));
  });
});
