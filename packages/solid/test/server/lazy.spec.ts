import { describe, expect, test } from "vitest";
import { createComponent, ErrorBoundary, lazy, Suspense } from "../../src/server/index.js";
import { renderToStream, renderToStringAsync } from "../../web/server/index.js";

type Text = () => string;

function renderBroken(render: (code: () => any) => any) {
  const Broken = lazy<Text>(() => Promise.reject(new Error("boom")));
  return render(() =>
    createComponent(ErrorBoundary, {
      fallback: (err: Error) => `error boundary: ${err.message}`,
      get children() {
        return createComponent(Suspense, {
          fallback: "loading",
          get children() {
            return createComponent(Broken, {});
          }
        });
      }
    })
  );
}

function collect(stream: ReturnType<typeof renderToStream>) {
  return new Promise<string>((resolve, reject) => {
    let html = "";
    const timeout = setTimeout(() => reject(new Error("stream never ended")), 2000);
    stream.pipe({
      write: (chunk: string) => (html += chunk),
      end: () => {
        clearTimeout(timeout);
        resolve(html);
      }
    });
  });
}

describe("lazy() with a rejected module promise on the server", () => {
  test("renderToStream ends and the ErrorBoundary renders", async () => {
    const html = await collect(renderBroken(renderToStream));
    expect(html).toContain("error boundary: boom");
  });

  test("renderToStringAsync resolves and the ErrorBoundary renders", async () => {
    const html = await renderBroken(renderToStringAsync);
    expect(html).toContain("error boundary: boom");
  });

  test("a resolved module still renders", async () => {
    const Lazy = lazy<Text>(() => Promise.resolve({ default: () => "content" }));
    const html = await collect(
      renderToStream(() =>
        createComponent(Suspense, {
          fallback: "loading",
          get children() {
            return createComponent(Lazy, {});
          }
        })
      )
    );
    expect(html).toContain("content");
  });

  test("a rejected module is retried on the next request", async () => {
    let attempts = 0;
    let shouldFail = true;
    const Lazy = lazy<Text>(async () => {
      attempts++;
      if (shouldFail) throw new Error("boom");
      return { default: () => "content" };
    });
    const render = () =>
      createComponent(ErrorBoundary, {
        fallback: (err: Error) => `error boundary: ${err.message}`,
        get children() {
          return createComponent(Suspense, {
            fallback: "loading",
            get children() {
              return createComponent(Lazy, {});
            }
          });
        }
      });

    const html1 = await collect(renderToStream(render));
    expect(html1).toContain("error boundary: boom");
    expect(attempts).toBe(1);

    shouldFail = false;
    const html2 = await collect(renderToStream(render));
    expect(html2).toContain("content");
    expect(attempts).toBe(2);
  });
});
