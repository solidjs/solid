/**
 * @jsxImportSource @solidjs/web
 */
// Occlusion — client half. Hydrates the document
// test/server/frame-occlusion-document.spec.tsx rendered: item `a`'s excerpt
// arrived as an `sc:region:` record only, item `b`'s as markup only. With
// every request failing, expanding `a` mounts its excerpt from the record,
// and collapsing then expanding `b` remounts its excerpt — nothing leaves
// the browser, and each excerpt is on screen exactly once.
import { describe, expect, test, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { makeHost } from "../lifecycle-matrix/harness.js";
import { ARGS, FID, ITEMS, makeApp } from "../harness/frame-occlusion-document.jsx";
import { applyChunk, drain, loadArtifact } from "./frame-live-document-helpers.js";

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("document face — occluded slot content — hydrate", () => {
  test("expand mounts the record; collapse and expand remount; no request", async () => {
    const { shell } = loadArtifact("frame-occlusion-document");
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const container = document.createElement("div");
    document.body.appendChild(container);
    installServerComponents(makeHost().host);

    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: any) => {
      urls.push(typeof input === "string" ? input : input.url);
      throw new Error("unexpected fetch");
    });
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    });
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    const list = createServerReference(FID);
    const App = makeApp(() => list(...ARGS));

    applyChunk(container, shell, true);
    const [a, b] = ITEMS;
    const excerptOf = (id: string) => container.querySelector(`#item-${id} .excerpt`);
    const toggle = async (id: string) => {
      container.querySelector<HTMLButtonElement>(`#toggle-${id}`)!.click();
      flush();
      await drain();
    };
    const before = {
      itemA: container.querySelector("#item-a"),
      itemB: container.querySelector("#item-b"),
      excerptB: excerptOf("b")
    };
    expect(excerptOf("a"), "a's excerpt is not in the document").toBeNull();
    expect(before.excerptB, "b's excerpt is in the document").not.toBeNull();

    const dispose = hydrate(() => <App />, container);
    flush();
    await drain();

    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
    expect(container.querySelector("#item-a"), "same item a").toBe(before.itemA);
    expect(container.querySelector("#item-b"), "same item b").toBe(before.itemB);
    expect(excerptOf("b"), "b's excerpt adopted").toBe(before.excerptB);
    expect(excerptOf("a"), "a stays collapsed").toBeNull();

    // Occluded at first render: expanding mounts it from the region record.
    await toggle("a");
    const excerptA = excerptOf("a");
    expect(excerptA?.textContent, "a's excerpt mounted").toBe(a.excerpt);
    expect(excerptA!.closest("solid-frame")!.getAttribute("data-fid")).toBe(
      `${FID}.item#a.expandedChildren`
    );

    // Open at first render: collapse unmounts, expand remounts.
    await toggle("b");
    expect(excerptOf("b"), "b collapsed").toBeNull();
    await toggle("b");
    expect(excerptOf("b")?.textContent, "b's excerpt remounted").toBe(b.excerpt);

    // The record-mounted excerpt remounts too.
    await toggle("a");
    expect(excerptOf("a"), "a collapsed").toBeNull();
    await toggle("a");
    expect(excerptOf("a")?.textContent, "a's excerpt remounted").toBe(a.excerpt);

    console.log("[occlusion]", {
      urls,
      warnings,
      errors,
      sameExcerptB: excerptOf("b") === before.excerptB,
      sameExcerptA: excerptOf("a") === excerptA,
      html: container.innerHTML
    });

    for (const it of ITEMS) {
      expect(count(container.textContent!, it.excerpt), `${it.id} excerpt on screen once`).toBe(1);
      expect(count(container.textContent!, it.title), `${it.id} header on screen once`).toBe(1);
    }
    expect(urls, "no request left the browser").toEqual([]);
    expect(errors).toEqual([]);

    dispose();
    container.remove();
  });
});
