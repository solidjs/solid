/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #3852: a watched slot arg re-ships the occurrence's record on every server
// commit, and each re-ship re-runs the fill's per-key async-arg memo — a new
// flight superseding the one still in the air, by design. ABANDONED_FLIGHTS
// does not judge that memo; a user memo churning flights inside the fill
// still warns.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, flush, Loading, OBSERVE } from "solid-js";
import type { DiagnosticEvent } from "solid-js";
import { attribution } from "solid-js/attribution";
import { dynamic } from "../src/index.js";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { createJSONDataTable, createJSONSerializer } from "../serialization/src/serializer.js";
import { createServerReference } from "../server-functions/src/client.js";
import { createChunk } from "../server-functions/src/shared.js";

const settle = () => new Promise(r => setTimeout(r));
const getReply = createServerReference("reply/get");

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (ref: any) => table.resolve(ref)
  });
}

const disposers: Array<() => void> = [];
beforeEach(() => installServerComponents(makeHost()));
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  attribution.disable();
  flush();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function capture() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const events: DiagnosticEvent[] = [];
  disposers.push(
    OBSERVE!.diagnostics.subscribe(e => {
      if (e.code === "ABANDONED_FLIGHTS") events.push(e);
    })
  );
  attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
  return events;
}

/**
 * The chat reply's status slot: `progress` a scalar the server re-ships on
 * every commit, `stats` a promise still pending until generation ends.
 */
async function streamReply(fill: (p: any) => any) {
  let resolveStats!: (v: string) => void;
  const statsPromise = new Promise<string>(r => (resolveStats = r));
  const dataRecords: any[] = [];
  const ser = createJSONSerializer({ onData: (r: any) => dataRecords.push(r) });
  ser.write("arg:status#0:stats", statsPromise);
  const initialData = dataRecords.splice(0);

  let controller!: ReadableStreamDefaultController;
  const body = new ReadableStream({ start: c => (controller = c) });
  const send = (chunk: any) => controller.enqueue(createChunk(JSON.stringify(chunk)));
  const record = (progress: string) => ({
    type: "slot",
    id: "srv",
    version: 1,
    key: "status#0",
    args: { progress, stats: { $ref: "arg:status#0:stats" } }
  });
  vi.stubGlobal("fetch", async () => {
    send({ type: "start", id: "srv", version: 1 });
    send(record("0 tokens"));
    for (const r of initialData) send({ type: "data", id: "srv", version: 1, ...r });
    send({
      type: "html",
      id: "srv",
      version: 1,
      html: "<article><!--slot:status#0:start--><!--slot:status#0:end--></article>"
    });
    return new Response(body, { headers: { "X-Frame-Stream": "srv" } });
  });

  const Reply = dynamic(() => getReply("hi") as any);
  let div!: HTMLDivElement;
  disposers.push(
    createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>typing</span>}>
          <Reply status={fill} />
        </Loading>
      </div>;
      document.body.appendChild(div);
      return () => (d(), div.remove());
    })
  );
  const tick = async () => {
    flush();
    await settle();
    flush();
    await settle();
  };
  await tick();

  for (const n of [1, 2, 3, 4, 5]) {
    send(record(`${n * 10} tokens`));
    await tick();
  }
  expect(div.querySelector(".progress")!.textContent).toBe("50 tokens");

  resolveStats("done");
  await settle();
  for (const r of dataRecords.splice(0)) send({ type: "data", id: "srv", version: 1, ...r });
  send({ type: "complete", id: "srv", version: 1 });
  controller.close();
  await tick();
  expect(div.querySelector(".stats")!.textContent).toBe("done");
}

describe("ABANDONED_FLIGHTS and re-shipped slot args (#3852)", () => {
  test("a pending arg re-read on every re-ship does not warn", async () => {
    const events = capture();
    await streamReply(p => (
      <p>
        <span class="progress">{p.progress}</span>
        <Loading fallback="…">
          <span class="stats">{p.stats}</span>
        </Loading>
      </p>
    ));
    expect(events).toEqual([]);
  });

  test("a user memo minting a fresh flight per re-ship still warns", async () => {
    const events = capture();
    await streamReply(p => {
      const ticker = createMemo(
        () => {
          const line = p.progress;
          return new Promise<string>(r => setTimeout(() => r(line), 1000));
        },
        { name: "ticker" }
      );
      return (
        <p>
          <span class="progress">{p.progress}</span>
          <Loading fallback="…">
            <span class="ticker">{ticker()}</span>
          </Loading>
          <Loading fallback="…">
            <span class="stats">{p.stats}</span>
          </Loading>
        </p>
      );
    });
    expect(events.map(e => e.nodeName)).toEqual(["ticker"]);
  });
});
