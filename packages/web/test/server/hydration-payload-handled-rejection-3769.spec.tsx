/**
 * @jsxImportSource @solidjs/web
 *
 * #3769 — an async read that rejects under `<Errored>`: the boundary renders
 * its fallback and serializes the error, but the source's own record is in
 * the inline payload too, and the promise the payload builds for it rejects
 * with nothing attached. The browser raised `unhandledrejection` from the
 * inline script alone, for an error a boundary already handled.
 *
 * The payload runs here the way a browser runs it — the real bootstrap
 * (`HydrationScript`) and every inline script, in their own realm — with
 * this test owning the process's `unhandledRejection` listeners, so a leak
 * from the payload fails THIS test.
 */
import vm from "node:vm";
import { describe, expect, test } from "vitest";
import { HydrationScript, renderToStream, Errored, Loading } from "@solidjs/web";
import { createMemo } from "solid-js";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function watchRejections(run: () => Promise<void> | void) {
  const previous = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const escaped: unknown[] = [];
  const capture = (reason: unknown) => escaped.push(reason);
  process.on("unhandledRejection", capture);
  try {
    await run();
    for (let turn = 0; turn < 4; turn++) await delay(20);
    return escaped;
  } finally {
    process.off("unhandledRejection", capture);
    for (const listener of previous) process.on("unhandledRejection", listener as any);
  }
}

/** Runs the document's inline scripts in a fresh realm; returns its `_$HY`. */
function runPayload(html: string) {
  const sandbox: any = {
    document: { getElementById: () => null, addEventListener() {} }
  };
  sandbox.window = sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const [, src] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(src, sandbox);
  }
  return sandbox._$HY;
}

function useRead(ms: number) {
  return createMemo(async () => {
    await delay(ms);
    throw new Error("boom");
  });
}

function Read(props: { ms: number }) {
  const value = useRead(props.ms);
  return <p>{value()}</p>;
}

function Page(props: { children: any }) {
  return (
    <html>
      <head>
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}

async function render(code: () => any) {
  let html = "";
  await new Promise<void>(end =>
    renderToStream(code).pipe({ write: (c: unknown) => void (html += String(c)), end } as any)
  );
  return html;
}

describe("#3769 a rejection an <Errored> handled", () => {
  test("rejecting before the shell raises no unhandled rejection from the payload", async () => {
    let html = "";
    const escaped = await watchRejections(async () => {
      html = await render(() => (
        <Page>
          <Errored fallback={<p>fallback</p>}>
            <Read ms={0} />
          </Errored>
        </Page>
      ));
      expect(html).toMatch(/<p[^>]*>fallback<\/p>/);
      expect(html).toMatch(/_\$HY\.r\[/);
      runPayload(html);
    });
    expect(escaped).toEqual([]);
  });

  test("rejecting after the shell, under a <Loading>, raises none either", async () => {
    let html = "";
    const escaped = await watchRejections(async () => {
      html = await render(() => (
        <Page>
          <Loading fallback={<p>loading</p>}>
            <Errored fallback={<p>fallback</p>}>
              <Read ms={30} />
            </Errored>
          </Loading>
        </Page>
      ));
      expect(html).toMatch(/<p[^>]*>fallback<\/p>/);
      runPayload(html);
    });
    expect(escaped).toEqual([]);
  });

  test("a consumer reading the record still sees the rejection", async () => {
    let seen: unknown;
    const escaped = await watchRejections(async () => {
      const html = await render(() => (
        <Page>
          <Errored fallback={<p>fallback</p>}>
            <Read ms={0} />
          </Errored>
        </Page>
      ));
      const hy = runPayload(html);
      const records = Object.values(hy.r).filter(
        (v: any) => v && typeof v.then === "function"
      ) as Promise<unknown>[];
      expect(records.length).toBeGreaterThan(0);
      await delay(0);
      seen = await Promise.allSettled(records);
    });
    expect(escaped).toEqual([]);
    expect(
      (seen as PromiseSettledResult<unknown>[]).some(
        r => r.status === "rejected" && (r.reason as Error).message === "boom"
      )
    ).toBe(true);
  });
});
