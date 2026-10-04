/**
 * @jsxImportSource @solidjs/web
 */
// A shell suspension above <Errored> (a lazy memo throwing NotReadyError on a
// request-scoped promise — the router's flash-decode shape) holds the
// boundary's children, placeholders included, in its retry state: the whole
// subtree is a pending root hole. A <Loading> below it whose content settles
// first must still land in the shell, and nothing above the boundary may
// re-render on the retry.
import { describe, expect, test } from "vitest";
import { renderToStream, dynamic, Errored, Loading } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { createMemo, NotReadyError } from "solid-js";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function render(code: () => any, ms = 1000): Promise<string> {
  const done = new Promise<string>(resolve => {
    const chunks: string[] = [];
    renderToStream(code, { plugins: [ServerComponentPlugin] } as any).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        resolve(chunks.join(""));
      }
    });
  });
  return Promise.race([done, delay(ms).then(() => "TIMEOUT")]);
}

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");

type Content = "server component" | "async memo";

function setup(content: Content) {
  const counts = { owner: 0, page: 0 };
  let decode: { done: boolean; promise: Promise<void> } | undefined;
  function Owner(props: { children: (read: () => string) => JSX.Element }) {
    counts.owner++;
    const data = createMemo(
      () => {
        if (!decode) {
          const d = { done: false } as { done: boolean; promise: Promise<void> };
          d.promise = delay(10).then(() => void (d.done = true));
          decode = d;
        }
        if (!decode.done) throw new NotReadyError(decode.promise);
        return "ready";
      },
      { lazy: true, transparent: true } as any
    );
    return <>{props.children(data)}</>;
  }
  const Note = () => <article>note body</article>;
  const answer = delay(1).then(() =>
    frameTransformDirectResult(Note, { id: "shell-suspend/note", args: [] })
  );
  function Page() {
    counts.page++;
    if (content === "async memo") {
      const v = createMemo(async () => {
        await delay(1);
        return "note body";
      });
      return <article>{v()}</article>;
    }
    const List = dynamic(() => answer as any);
    return <List />;
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
  return { counts, Owner, Page, Reader, Document };
}

for (const content of ["server component", "async memo"] as const)
  describe(`a <Loading> ${content} settling under a shell suspension`, () => {
    for (const errored of [true, false])
      for (const document of [true, false])
        test(`errored=${errored}, document=${document}`, async () => {
          const { counts, Owner, Page, Reader, Document } = setup(content);
          const Body = (read: () => string) => (
            <>
              <Reader read={read} />
              <Loading fallback={<p class="fb">loading</p>}>
                <Page />
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
          const html = await render(() =>
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
          expect(visibleText(html)).toContain("note body");
          expect(visibleText(html)).not.toContain("loading");
          expect(counts).toEqual({ owner: 1, page: 1 });
        });
  });
