/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Client half of the document live-channel parity pair (see
 * test/harness/document-live-channel.tsx): the chat welcome's timeline.
 * Hydration adopts the boundary against the SHELL (first yield in the
 * markup), then the rest of the document streams in — data scripts feeding
 * the `sc:live` channel with `hole` ops — and the adopted frame morphs its
 * range to each. The pump reads the record with `getReader()`: a channel
 * that crosses in any other shape leaves the card frozen at its first
 * paragraph, with no error anywhere (the bug this pins).
 *
 * Its own spec file: the frames client's boundary index and claim set are
 * module state — one page per module instance.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents, createFrameHost } from "../../frames/src/client.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";
import {
  reviveContainerTraces,
  isMaterializedContainer
} from "../../frames/src/frame-container-plugin.js";
import { FID, YIELDS } from "../harness/document-live-channel.jsx";
import { applyChunk, loadArtifact } from "./frame-live-document-helpers.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function settle() {
  await sleep(30);
  flush();
  await sleep(30);
  flush();
}

describe("document live channel — hydration (streamed)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (globalThis as any)._$HY;
    delete (globalThis as any)._$SC;
    delete (globalThis as any).$R;
    document.body.innerHTML = "";
  });

  test("the adopted boundary morphs its hole to every op the document streams after hydration", async () => {
    const { shell, rest } = loadArtifact("document-live-channel-streamed");
    const container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    const table = createJSONDataTable();
    installServerComponents(
      createFrameHost({
        applyData: (c: any) => table.apply(c),
        resolve: (r: any) => table.resolve(r),
        revive: reviveContainerTraces,
        isContainer: isMaterializedContainer
      })
    );
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: any[]) => {
      warnings.push(args.map(String).join(" "));
    });

    // The shell: first yield in the markup.
    applyChunk(container, shell, true);
    const frame = container.querySelector(`solid-frame[data-fid="${FID}"]`)!;
    expect(frame).toBeTruthy();
    const md = container.querySelector(".md")!;
    expect(md.textContent).toBe(YIELDS[0]);

    const SC = (globalThis as any)._$SC.r(FID);
    const dispose = hydrate(() => <SC />, container);
    flush();
    await Promise.resolve();
    flush();

    // The rest of the document: the channel's ops, arriving after adoption.
    applyChunk(container, rest, false);
    await settle();

    // The card streamed in: the range reads the LAST yield, through the
    // same `.md` element (a morph of the range, not a re-render).
    expect(container.querySelector(".md")).toBe(md);
    expect(md.textContent).toBe(YIELDS[YIELDS.length - 1]);
    expect(warnings).toEqual([]);

    dispose();
    container.remove();
  });
});
