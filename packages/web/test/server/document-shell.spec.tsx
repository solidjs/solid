/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the document-shell pattern tests (#3000) — see
 * test/harness/document-shell.tsx. Renders the NoHydration document with the
 * Hydration island and pins the exact app-root markup the client half
 * hydrates against.
 */
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { App, AsyncApp, HeadShellApp, Shell, APP_ROOT_MARKUP } from "../harness/document-shell.jsx";
import { hydrationRecordKeys } from "../harness/hydration-records.js";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

function collectChunks(code: () => any): Promise<string[]> {
  return new Promise(resolvePromise => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        resolvePromise(chunks);
      }
    });
  });
}

describe("document-shell pattern — server render (#3000)", () => {
  test("NoHydration shell + Hydration island gives the app a clean id namespace", async () => {
    const html = (
      await collectChunks(() => (
        <Shell>
          <App />
        </Shell>
      ))
    ).join("");

    // The island's markup is exactly what the client half hydrates against.
    expect(html).toContain(`<div id="app-root">${APP_ROOT_MARKUP}</div>`);
    // The shell itself is out of the hydration namespace: the only _hk on
    // the page belongs to the island (a document-tree id like the plain
    // component shape's _hk=10 would be unclaimable by hydrate(<App/>)).
    expect(html.match(/_hk/g)).toHaveLength(1);
  });

  test("async island: serialized records live in the island namespace", async () => {
    const chunks = await collectChunks(() => (
      <Shell>
        <AsyncApp />
      </Shell>
    ));
    const html = chunks.join("");

    // The async memo's serialized record is keyed under the island's ids —
    // "0", not a document-tree id (the plain-component shape serializes the
    // same record as "10", which a subtree hydrate() can never look up).
    const rKeys = hydrationRecordKeys(html);
    expect(rKeys).toContain("0");
    expect(rKeys).not.toContain("10");
    expect(html).toContain("server-data");

    // The client half replays these chunks and must adopt the record by id.
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      resolve(artifactsDir, "document-shell-async.json"),
      JSON.stringify({ chunks }, null, 2)
    );
  });

  test("useHead + shell-authored head children: prelude tag injected ahead, title rewritten in place (#3081)", async () => {
    const chunks = await collectChunks(() => <HeadShellApp />);
    const html = chunks.join("");

    // The charset prelude splices right after `<head>` — BEFORE every
    // shell-authored head child (its placement constraint). The client half
    // must hydrate over that shift.
    expect(html.indexOf('data-dh="charset"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-dh="charset"')).toBeLessThan(html.indexOf('name="shell-owned"'));
    // The shell's static <title> is rewritten in place, keeping its position:
    // winner text in the element, original stashed on data-dhf.
    expect(html).toContain(
      '<title data-dh="title" data-dhf="shell fallback title">managed title</title>'
    );

    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      resolve(artifactsDir, "document-shell-usehead-head.json"),
      JSON.stringify({ chunks }, null, 2)
    );
  });
});
