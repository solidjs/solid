/**
 * @jsxImportSource @solidjs/web
 */
// The awaited render (`renderToStream(...).then`) under a shell suspension —
// a lazy memo throwing NotReadyError on a request-scoped promise, the
// router's flash-decode shape — with a <Loading> below whose content settles
// before the suspension does.
import { describe, expect, test } from "vitest";
import { renderToStream, Errored, Loading } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { createMemo, NotReadyError } from "solid-js";

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function settle(code: () => any, ms = 1000): Promise<string> {
  return Promise.race([
    new Promise<string>(resolve => renderToStream(code).then(resolve)),
    delay(ms).then(() => "TIMEOUT")
  ]);
}

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");

function setup(shellMs: number, contentMs: number) {
  let decode: { done: boolean; promise: Promise<void> } | undefined;
  function Owner(props: { children: (read: () => string) => JSX.Element }) {
    const data = createMemo(
      () => {
        if (!decode) {
          const d = { done: false } as { done: boolean; promise: Promise<void> };
          d.promise = delay(shellMs).then(() => void (d.done = true));
          decode = d;
        }
        if (!decode.done) throw new NotReadyError(decode.promise);
        return "ready";
      },
      { lazy: true, transparent: true } as any
    );
    return <>{props.children(data)}</>;
  }
  function Content() {
    const v = createMemo(async () => {
      await delay(contentMs);
      return "content body";
    });
    return <article>{v()}</article>;
  }
  function Reader(props: { read: () => string }) {
    return <p class="value">{props.read()}</p>;
  }
  function Document(props: { children?: JSX.Element }) {
    return (
      <html>
        <head />
        <body>{props.children}</body>
      </html>
    );
  }
  return { Owner, Content, Reader, Document };
}

describe("a shell suspension's re-pull serializes into the document", () => {
  for (const mode of ["pipe", "then"] as const)
    test(mode, async () => {
      const { Owner, Content } = setup(10, 1);
      // Re-runs once the suspension settles; its async value serializes then.
      function Data() {
        const v = createMemo(async () => "shell-data-value");
        return <i>{v()}</i>;
      }
      function ShellData(props: { read: () => string }) {
        return <p>{props.read() && <Data />}</p>;
      }
      const code = () => (
        <Owner>
          {read => (
            <>
              <ShellData read={read} />
              <Loading fallback={<p class="fb">loading</p>}>
                <Content />
              </Loading>
            </>
          )}
        </Owner>
      );
      const html =
        mode === "then"
          ? await settle(code)
          : await Promise.race([
              new Promise<string>(resolve => {
                const chunks: string[] = [];
                renderToStream(code).pipe({
                  write: (c: string) => void chunks.push(c),
                  end: () => resolve(chunks.join(""))
                });
              }),
              delay(1000).then(() => "TIMEOUT")
            ]);
      expect(html).not.toBe("TIMEOUT");
      expect(visibleText(html)).toContain("shell-data-value");
      expect(html).toMatch(/<script[^>]*>[^<]*shell-data-value/);
    });
});

for (const [label, shellMs, contentMs] of [
  ["content settles first", 10, 1],
  ["shell settles first", 1, 10]
] as const)
  describe(`awaited render, a shell suspension above <Loading> (${label})`, () => {
    for (const errored of [true, false])
      for (const document of [true, false])
        test(`errored=${errored}, document=${document}`, async () => {
          const { Owner, Content, Reader, Document } = setup(shellMs, contentMs);
          const Body = (read: () => string) => (
            <>
              <Reader read={read} />
              <Loading fallback={<p class="fb">loading</p>}>
                <Content />
              </Loading>
            </>
          );
          const App = () => (
            <Owner>
              {read =>
                errored ? (
                  <Errored fallback={err => <p>error: {String(err())}</p>}>{Body(read)}</Errored>
                ) : (
                  Body(read)
                )
              }
            </Owner>
          );
          const html = await settle(() =>
            document ? (
              <Document>
                <App />
              </Document>
            ) : (
              <App />
            )
          );
          expect(html).not.toBe("TIMEOUT");
          expect(html).toContain('class="value">ready</p>');
          expect(visibleText(html)).toContain("content body");
          expect(visibleText(html)).not.toContain("loading");
        });
  });
