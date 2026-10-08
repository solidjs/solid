/**
 * @jsxImportSource @solidjs/web
 */
// `dynamicComponent` — server half. The page of
// test/harness/dynamic-component-parity.tsx rendered through `dynamic` and
// through `dynamicComponent` over the in-process answer of a NON-LIVE server
// component (a promise of the component wrapped by
// `frameTransformDirectResult`) and a sync client component. The two
// documents must be byte-identical: the entry points share one
// implementation with one owner shape (factory / value / render memo), so
// the hydration keys, the frame markup and the `_fr` record all agree.
// Writes the chunk artifacts test/hydration/dynamic-component-parity.spec.tsx
// replays (from the `dynamicComponent` render — the documented mount).
import { describe, expect, test } from "vitest";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import {
  ARGS,
  VARIANTS,
  VIAS,
  artifactFor,
  fidFor,
  makeApp,
  makeNoteComponent,
  type Via
} from "../harness/dynamic-component-parity.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const collectChunks = (code: () => any) =>
  recordStream(code, { plugins: [ServerComponentPlugin] } as any);

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");
// The `_hk` family — the framework's hydration keys (`ssrHydrationKey`), one
// per claimable element, including the memo-derived paths under each mount.
const hydrationKeys = (html: string) => [...html.matchAll(/ _hk=([^ >]+)/g)].map(m => m[1]);

describe("dynamicComponent — the server twin renders exactly what dynamic renders", () => {
  for (const variant of VARIANTS) {
    const FID = fidFor(variant);
    test(`${variant}: same document, same hydration keys; writes the artifact`, async () => {
      const Inline = frameTransformDirectResult(makeNoteComponent("note v1"), {
        id: FID,
        args: ARGS
      }) as any;
      const source =
        variant === "inline"
          ? () => Promise.resolve(Inline)
          : async () => {
              await sleep(5);
              return Inline;
            };

      const rendered = {} as Record<Via, { shell: string; rest: string }>;
      for (const via of VIAS) {
        const App = makeApp(via, source);
        rendered[via] = await collectChunks(() => <App />);
        const full = rendered[via].shell + rendered[via].rest;
        console.log(
          `${FID} via ${via} SHELL:\n${rendered[via].shell}\n\nREST:\n${rendered[via].rest}`
        );

        expect(visibleText(full)).toContain("client");
        expect(visibleText(full)).toContain("note v1");
        expect(full).toContain(`data-fid="${FID}"`);
        if (variant === "inline") {
          expect(visibleText(rendered[via].shell)).not.toContain("shell-fallback");
          expect(rendered[via].rest).toBe("");
        } else {
          expect(visibleText(rendered[via].shell)).toContain("shell-fallback");
          expect(rendered[via].rest).toContain(`data-fid="${FID}"`);
        }
      }

      // Same hydration keys (the owner shape), stated on their own before
      // the byte-for-byte comparison says the same thing less legibly.
      expect(
        hydrationKeys(rendered.dynamicComponent.shell + rendered.dynamicComponent.rest)
      ).toEqual(hydrationKeys(rendered.dynamic.shell + rendered.dynamic.rest));
      expect(hydrationKeys(rendered.dynamic.shell).length).toBeGreaterThan(0);
      expect(rendered.dynamicComponent.shell).toBe(rendered.dynamic.shell);
      expect(rendered.dynamicComponent.rest).toBe(rendered.dynamic.rest);

      const { shell, rest } = rendered.dynamicComponent;
      writeArtifact(artifactFor(variant), { name: artifactFor(variant), shell, rest });
    });
  }
});
