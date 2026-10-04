/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToStream, Errored, Loading } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { createMemo, lazy, NotReadyError } from "solid-js";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function settle(code: () => any, options?: object, ms = 1000): Promise<string> {
  return Promise.race([
    new Promise<string>(resolve => renderToStream(code, options).then(resolve)),
    delay(ms).then(() => "TIMEOUT")
  ]);
}

type Decode = { done: boolean; promise?: Promise<void> };

function setup(scope: "instance" | "request") {
  const counts = { owner: 0 };
  let requestDecode: Decode | undefined;
  // A stateful ancestor with the router's flash-decode shape: a transparent
  // lazy memo that throws NotReadyError carrying a cached promise.
  function Owner(props: { children: (read: () => string) => JSX.Element }) {
    counts.owner++;
    let instanceDecode: Decode | undefined;
    const data = createMemo(
      () => {
        let decode = scope === "instance" ? instanceDecode : requestDecode;
        if (!decode) {
          const d: Decode = { done: false };
          d.promise = delay(5).then(() => void (d.done = true));
          decode = d;
          if (scope === "instance") instanceDecode = d;
          else requestDecode = d;
        }
        if (!decode.done) throw new NotReadyError(decode.promise);
        return "ready";
      },
      { lazy: true, transparent: true } as any
    );
    return <>{props.children(data)}</>;
  }
  function BodyReader(props: { read: () => string }) {
    const value = createMemo(() => props.read());
    return <p class="value">{value()}</p>;
  }
  function TemplateReader(props: { read: () => string }) {
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
  return { counts, Owner, BodyReader, TemplateReader, Document };
}

describe("a shell suspension beside an async <Loading> child", () => {
  function Async() {
    const value = createMemo(async () => {
      await delay(5);
      return "async-done";
    });
    return <p class="async">{value()}</p>;
  }
  for (const where of ["shell", "loading"] as const)
    for (const errored of [true, false])
      for (const document of [true, false])
        test(`read in ${where}, errored=${errored}, document=${document}`, async () => {
          const { Owner, BodyReader, Document } = setup("request");
          const Body = (read: () => string) => (
            <>
              {where === "shell" && <BodyReader read={read} />}
              <Loading fallback="loading">
                {where === "loading" && <BodyReader read={read} />}
                <Async />
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
          expect(html).toContain('class="value">ready</p>');
          expect(html).toContain("async-done");
        });
});

describe("a shell suspension under <Errored>", () => {
  for (const scope of ["instance", "request"] as const)
    for (const reader of ["body", "template"] as const)
      for (const errored of [true, false])
        for (const document of [true, false])
          test(`${scope} source, ${reader} read, errored=${errored}, document=${document}`, async () => {
            const { counts, Owner, BodyReader, TemplateReader, Document } = setup(scope);
            const Reader = reader === "body" ? BodyReader : TemplateReader;
            const App = () => (
              <Owner>
                {read =>
                  errored ? (
                    <Errored fallback={err => <p>error: {String(err())}</p>}>
                      <Reader read={read} />
                      <Loading fallback="loading">tail</Loading>
                    </Errored>
                  ) : (
                    <>
                      <Reader read={read} />
                      <Loading fallback="loading">tail</Loading>
                    </>
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
            expect(html).toContain('class="value">ready</p>');
            expect({ owner: counts.owner }).toEqual({ owner: 1 });
          });
});

describe("a lazy route under <Errored> with no <Loading>", () => {
  for (const document of [true, false])
    test(`document=${document}`, async () => {
      const counts = { layout: 0 };
      const Route = lazy(
        () => delay(5).then(() => ({ default: () => <p class="route">route body</p> })),
        undefined,
        "./Route.tsx"
      );
      function Layout(props: { children?: JSX.Element }) {
        counts.layout++;
        return <>{props.children}</>;
      }
      const App = () => (
        <Layout>
          <Errored fallback={err => <p>error: {String(err())}</p>}>
            <Route />
          </Errored>
        </Layout>
      );
      const { Document } = setup("request");
      const html = await settle(
        () =>
          document ? (
            <Document>
              <App />
            </Document>
          ) : (
            <App />
          ),
        { manifest: { "./Route.tsx": { file: "assets/route.js" } } }
      );
      expect(html).toContain('class="route">route body</p>');
      expect(counts).toEqual({ layout: 1 });
    });
});
