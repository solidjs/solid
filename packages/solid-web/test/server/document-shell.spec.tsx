/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the document-shell pattern tests (#3000) — see
 * test/harness/document-shell.tsx. Renders the NoHydration document with the
 * Hydration island and pins the exact app-root markup the client half
 * hydrates against.
 */
import { describe, expect, test } from "vitest";
import { renderToStream } from "@solidjs/web";
import { App, Shell, APP_ROOT_MARKUP } from "../harness/document-shell.jsx";

function collectChunks(code: () => any): Promise<string> {
  return new Promise(resolvePromise => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        resolvePromise(chunks.join(""));
      }
    });
  });
}

describe("document-shell pattern — server render (#3000)", () => {
  test("NoHydration shell + Hydration island gives the app a clean id namespace", async () => {
    const html = await collectChunks(() => (
      <Shell>
        <App />
      </Shell>
    ));

    // The island's markup is exactly what the client half hydrates against.
    expect(html).toContain(`<div id="app-root">${APP_ROOT_MARKUP}</div>`);
    // The shell itself is out of the hydration namespace: the only _hk on
    // the page belongs to the island (a document-tree id like the plain
    // component shape's _hk=10 would be unclaimable by hydrate(<App/>)).
    expect(html.match(/_hk/g)).toHaveLength(1);
  });
});
