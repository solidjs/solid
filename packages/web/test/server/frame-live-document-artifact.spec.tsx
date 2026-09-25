/**
 * @jsxImportSource @solidjs/web
 */
// The document face of a live server component (Stage 8 B3) — server half.
// `dynamic(() => room("a"))` over the in-process answer: a promise of the
// component, branded by `live`'s server wrapper. The scope flag takes the
// first value of the room's standing source into the markup and closes it;
// the document completes. Writes the chunk artifact the hydration spec
// replays (test/hydration/frame-live-document.spec.tsx).
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import {
  ARGS,
  MODES,
  fidFor,
  makeApp,
  makeRoomComponent
} from "../harness/frame-live-document.jsx";

const LIVE_SOURCE = Symbol.for("solid.LiveSource");
const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

function collectChunks(code: () => any): Promise<{ shell: string; rest: string }> {
  return new Promise(resolvePromise => {
    const chunks: string[] = [];
    let shell = "";
    let shellDone = false;
    renderToStream(code, {
      plugins: [ServerComponentPlugin],
      onCompleteShell() {
        shellDone = true;
      }
    } as any).pipe({
      write(chunk: string) {
        chunks.push(chunk);
        if (shellDone && !shell) shell = chunks.join("");
      },
      end() {
        const full = chunks.join("");
        if (!shell) shell = full;
        resolvePromise({ shell, rest: full.slice(shell.length) });
      }
    });
  });
}

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");

describe("document face — live server component (server render, writes the artifacts)", () => {
  for (const mode of MODES) {
    const FID = fidFor(mode);
    test(`${mode}: first value in the markup, source closed, document completes`, async () => {
      const { RoomComponent, state } = makeRoomComponent("room");
      // What the in-process `live(GET(fn))` answer is: `frameTransformDirectResult`
      // wraps the component for inline rendering, and `brandLive` marks it.
      const Inline = frameTransformDirectResult(RoomComponent, { id: FID, args: ARGS }) as any;
      Inline[LIVE_SOURCE] = true;
      const App = makeApp(() => Promise.resolve(Inline));

      const { shell, rest } = await collectChunks(() => <App />);
      const full = shell + rest;

      // The room's first value is the document's; the source was closed and
      // pulled once. Reaching here at all is the completion proof.
      expect(visibleText(full)).toContain("room v1");
      expect(full).not.toContain("room v2");
      expect(state.closed).toBe(true);
      expect(state.pulls).toBe(1);
      // The frame element and the composer slot's range are in the page. No
      // hydration reference for the call travels: `dynamic`'s memo is not
      // serialized, and none is needed — the client's intercept derives the
      // call's address from its own (id, args) and adopts the boundary by id.
      expect(full).toContain(`data-fid="${FID}"`);
      expect(full).toContain("slot:composer");
      expect(full).not.toContain("_$SC");

      writeFileSync(
        resolve(artifactsDir, `frame-live-document-${mode}.json`),
        JSON.stringify({ name: `frame-live-document-${mode}`, shell, rest }, null, 2)
      );
    });
  }
});
