/**
 * @jsxImportSource @solidjs/web
 */
// Occlusion — server half. Server content passed to a client slot ships
// exactly once: as markup where the fill placed it at first render, as an
// `sc:region:` record where it did not. Writes the artifact
// test/hydration/frame-occlusion-document.spec.tsx hydrates.
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import {
  ARGS,
  FID,
  ITEMS,
  LateItem,
  makeApp,
  makeListComponent
} from "../harness/frame-occlusion-document.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

function collect(code: () => any): Promise<string> {
  return new Promise(resolvePromise => {
    const chunks: string[] = [];
    renderToStream(code, { plugins: [ServerComponentPlugin] } as any).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        resolvePromise(chunks.join(""));
      }
    });
  });
}

const scripts = (html: string) =>
  [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
const markup = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

function render(Fill?: any) {
  const Inline = frameTransformDirectResult(makeListComponent(), { id: FID, args: ARGS }) as any;
  const App = makeApp(() => Promise.resolve(Inline), Fill);
  return collect(() => <App />);
}

describe("document face — occluded slot content — server render", () => {
  test("each excerpt ships once: markup where placed, a region record where not", async () => {
    const html = await render();
    console.log(`${FID}:\n${html}`);
    const [a, b] = ITEMS;

    // Headers are placed by every fill: markup, once.
    for (const it of ITEMS) {
      expect(count(markup(html), it.title), `${it.id} header in markup`).toBe(1);
      expect(count(scripts(html), it.title), `${it.id} header not in records`).toBe(0);
    }

    // `a` is collapsed at first render: the excerpt is a record, not markup.
    expect(count(html, a.excerpt), "a excerpt ships once").toBe(1);
    expect(count(markup(html), a.excerpt), "a excerpt not in markup").toBe(0);
    expect(scripts(html)).toContain(`sc:region:${FID}.item#a.expandedChildren`);
    expect(markup(html)).not.toContain(`data-fid="${FID}.item#a.expandedChildren"`);

    // `b` is open at first render: the excerpt is markup, not a record.
    expect(count(html, b.excerpt), "b excerpt ships once").toBe(1);
    expect(count(markup(html), b.excerpt), "b excerpt in markup").toBe(1);
    expect(scripts(html)).not.toContain(`sc:region:${FID}.item#b.expandedChildren`);
    expect(markup(html)).toContain(`data-fid="${FID}.item#b.expandedChildren"`);

    writeFileSync(
      resolve(artifactsDir, "frame-occlusion-document.json"),
      JSON.stringify({ name: "frame-occlusion-document", shell: html, rest: "" }, null, 2)
    );
  });

  test("a placement after the synchronous slot render is locked: the record, no markup", async () => {
    const html = await render(LateItem);
    console.log(`${FID} (late):\n${html}`);
    for (const it of ITEMS) {
      expect(count(html, it.excerpt), `${it.id} excerpt ships once`).toBe(1);
      expect(count(markup(html), it.excerpt), `${it.id} excerpt not in markup`).toBe(0);
      expect(scripts(html)).toContain(`sc:region:${FID}.item#${it.id}.expandedChildren`);
    }
  });
});
