/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test, vi } from "vitest";
import { renderToStream, Loading, useHead } from "@solidjs/web";
import { createMemo } from "solid-js";

// Head tags with async props (issue #2975). Head props are lazy descriptors
// nothing reads during render, so without the registration-time readiness
// probe (@solidjs/web registerHeadTags) a pending read would surface only
// at flush and warn-drop the tag. Under a Loading boundary the probe rethrows
// so the boundary suspends (gated on the `_loadingPhase` flag set by
// runWithBoundaryErrorContext); at root it holds the streaming shell on the
// pending source instead — the implicit-blocker semantics every other
// root-level async already has.

function asyncValue<T>(value: T, ms = 10): Promise<T> {
  return new Promise(r => setTimeout(() => r(value), ms));
}

function collectChunks(code: () => any): Promise<{ chunks: string[]; shell: string }> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    let shell = "";
    let shellDone = false;
    renderToStream(code, {
      onCompleteShell() {
        shellDone = true;
      }
    }).pipe({
      write(chunk: string) {
        chunks.push(chunk);
        if (shellDone && !shell) shell = chunks.join("");
      },
      end() {
        if (!shell) shell = chunks.join("");
        resolve({ chunks, shell });
      }
    });
  });
}

function PageTitle(props: { text: () => string }) {
  useHead({ tag: "title", props: { children: () => props.text() } });
  return null;
}

describe("SSR Streaming — useHead under Loading (issue #2975)", () => {
  test("async title suspends the boundary; resolved title streams as a head patch", async () => {
    function App() {
      const title = createMemo(() => asyncValue("Home - World", 15));
      return (
        <html>
          <head>
            <title>Fallback</title>
          </head>
          <body>
            <div>
              <Loading fallback={<span>Loading...</span>}>
                <PageTitle text={title} />
                <main>content</main>
              </Loading>
            </div>
          </body>
        </html>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");

    // The boundary suspended on the pending title prop: the shell carries
    // the fallback (and the static shell title), not the async content.
    expect(shell).toMatch(/<span[^>]*>Loading\.\.\.<\/span>/);
    expect(shell).toContain("<title>Fallback</title>");
    expect(shell).not.toContain("Home - World");

    // The resolved tag rides the boundary's stream as a head patch op
    // (`["t", ...]` sets the title when the fragment reveals).
    expect(full).toMatch(/<main[^>]*>content<\/main>/);
    expect(full).toContain('"t","Home - World"');
  });

  test("without a boundary a pending head prop holds the shell; the settled title renders in it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    function App() {
      const title = createMemo(() => asyncValue("Held Title", 10));
      return (
        <html>
          <head></head>
          <body>
            <PageTitle text={title} />
            <div>body</div>
          </body>
        </html>
      );
    }

    // Root-level async blocks the shell everywhere else (content holes,
    // render effects) — head props are no exception. There's no retryable
    // catch to suspend into, so the registry holds the shell on the pending
    // source via context.block and the post-settle flush commits the tag:
    // a shell <title>, not a patch op, and nothing warn-dropped.
    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(full).toContain("<div>body</div>");
    expect(shell).toContain(">Held Title</title>");
    expect(full).not.toContain('"t","Held Title"');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("retries re-register: a sync title beside async content dedupes to one tag", async () => {
    function App() {
      const data = createMemo(() => asyncValue("Streamed Data", 15));
      return (
        <html>
          <head></head>
          <body>
            <Loading fallback={<span>Loading...</span>}>
              <PageTitle text={() => "Sync Title"} />
              <span>{data()}</span>
            </Loading>
          </body>
        </html>
      );
    }

    // The first pass registers the title, then suspends on the async span;
    // the retry registers it again. Identity dedupe keeps one winner. The
    // boundary is pending at shell flush, so the title arrives as a patch
    // op riding the fragment reveal, not as a shell <title> element.
    const { chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(full).toContain("Streamed Data");
    const patchCount = (full.match(/"t","Sync Title"/g) || []).length;
    expect(patchCount).toBe(1);
  });

  test("async resource props under Loading suspend instead of dropping the resource", async () => {
    function AsyncScript(props: { src: () => string }) {
      useHead({ tag: "script", props: { src: () => props.src() } });
      return null;
    }
    function App() {
      const src = createMemo(() => asyncValue("/analytics.js", 15));
      return (
        <html>
          <head></head>
          <body>
            <Loading fallback={<span>Loading...</span>}>
              <AsyncScript src={src} />
              <main>content</main>
            </Loading>
          </body>
        </html>
      );
    }

    const { shell, chunks } = await collectChunks(() => <App />);
    const full = chunks.join("");
    expect(shell).not.toContain("/analytics.js");
    expect(full).toContain('<script src="/analytics.js">');
    expect(full).toMatch(/<main[^>]*>content<\/main>/);
  });
});
