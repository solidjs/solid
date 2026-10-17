/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// A write that morphs only live holes (a sweep's `ops` unit: the bulk of a
// live stream like the chat example's growing reply) still has its slot
// sync find what a full walk would: an occurrence that lives only in a hole
// mounting with the write that brings it and unmounting with the one that
// drops it, and the occurrences outside the hole untouched.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flush, Loading, onCleanup } from "solid-js";
import { dynamic, render } from "@solidjs/web";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { createJSONDataTable } from "../serialization/src/serializer.js";
import { createServerReference } from "../server-functions/src/client.js";
import { openFrameResponse } from "./lifecycle-matrix/harness.js";

const ID = "thread/scoped";

const settle = () => new Promise(r => setTimeout(r));
const cycle = async () => {
  flush();
  await settle();
  flush();
  await settle();
};

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (ref: any) => table.resolve(ref)
  });
}

const getThread = createServerReference(ID);

const range = (key: string) => `<!--slot:${key}:start--><!--slot:${key}:end-->`;

describe("slot sync after a write that morphs only live holes", () => {
  beforeEach(() => installServerComponents(makeHost()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("an occurrence inside a hole mounts and unmounts with the hole's writes; one outside is untouched", async () => {
    const held = openFrameResponse(ID);
    vi.stubGlobal("fetch", async () => held.response);
    let topFills = 0;
    let shareFills = 0;
    let shareCleanups = 0;
    const Thread = dynamic(() => getThread() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>wait</span>}>
          <Thread
            top={() => {
              topFills++;
              return <b class="top">top</b>;
            }}
            share={() => {
              shareFills++;
              onCleanup(() => shareCleanups++);
              return <b class="share">share</b>;
            }}
          />
        </Loading>
      ),
      container
    );
    held.send({ type: "start", id: ID, version: 1 });
    held.send({ type: "slot", id: ID, version: 1, key: "top#0", args: {} });
    held.send({
      type: "html",
      id: ID,
      version: 1,
      html: `<article><header>${range("top#0")}</header><div class="msg"><!--lh:0--><p>hi</p><!--lh:/0--></div></article>`
    });
    await cycle();
    expect(topFills).toBe(1);
    expect(container.querySelector("header .top")).not.toBe(null);

    const hole = (html: string) =>
      held.send({ type: "ops", id: ID, version: 1, ops: [{ type: "hole", key: "lh:0", html }] });

    // An occurrence that lives only in the hole mounts with the write that
    // brings it.
    held.send({ type: "slot", id: ID, version: 1, key: "share#0", args: {} });
    hole(`<p>hi</p>${range("share#0")}`);
    await cycle();
    expect(shareFills).toBe(1);
    expect(container.querySelector(".msg .share")).not.toBe(null);

    // The write that drops it unmounts it.
    hole(`<p>hi</p>`);
    await cycle();
    expect(shareCleanups).toBe(1);
    expect(container.querySelector(".msg .share")).toBe(null);

    // Back again: a fresh mount.
    held.send({ type: "slot", id: ID, version: 1, key: "share#0", args: {} });
    hole(`<p>bye</p>${range("share#0")}`);
    await cycle();
    expect(shareFills).toBe(2);
    expect(container.querySelector(".msg .share")).not.toBe(null);

    // The occurrence outside the hole never re-filled.
    expect(topFills).toBe(1);
    expect(container.querySelector("header .top")).not.toBe(null);

    held.send({ type: "complete", id: ID, version: 1 });
    held.close();
    await cycle();
    dispose();
    flush();
    container.remove();
  });
});
