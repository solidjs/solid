/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The traces tier — document face. A t=0 record (`_$HY.r["sc:slot:<fid>:
// <occ>"]`) carries the container as a `{ $tr, $ta }` marker literal that the
// host revives at arg-read — but the frames client no longer installs the
// materializer at module load (it is the `trace` tier, `@solidjs/web/frames/
// trace`), so the first such record finds the tier absent. The adopt-time
// sync's held-set predicate (`needsTrace`: a marker in the record's args
// while the tier is not resident) starts the load — the PRODUCTION loader,
// here through the test alias to the tier's source — and HOLDS the
// occurrence: its server-rendered interior stays on screen, no fill mounts,
// and when the load settles the install's flush re-syncs the frame and
// mounts the fill with the live store (nested references sharing it, as the
// resident path pins). A re-sent record after that revives synchronously.
//
// This page carries no `sc:tiers` record — the un-announced fallback: the
// readiness check itself starts the load, the same DOM, later (the
// announced path, where `installServerComponents` starts the import from the
// record before any boundary adopts, is hydration/welcome-status-lazy.spec).
//
// Its own spec file: a tier, once resident, stays so for the worker, and
// the "not loaded" half is observable only before the first install (see
// frames-container-lazy-codec.spec.tsx for the codec face).
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, flush, Loading, untrack } from "solid-js";
import { dynamic } from "../src/index.js";
import { getFrameHost, installServerComponents } from "../frames/src/client.js";
import { tierLoads } from "../frames/src/frame-client.js";
import { createServerReference } from "../server-functions/src/client.js";
import { pump } from "./lifecycle-matrix/harness.js";

const getAdopt = createServerReference("lazy/containers/adopt");
const traceTierResident = () => !!(tierLoads as any).trace?.r;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A hand-cranked trace: an async iterable whose yields the test pushes. */
function traceProducer() {
  const queue: IteratorResult<any>[] = [];
  const waiters: ((r: IteratorResult<any>) => void)[] = [];
  const put = (r: IteratorResult<any>) => {
    const w = waiters.shift();
    w ? w(r) : queue.push(r);
  };
  return {
    subscribe: () => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            const b = queue.shift();
            return b
              ? Promise.resolve(b)
              : new Promise<IteratorResult<any>>(res => waiters.push(res));
          }
        };
      }
    }),
    push: (value: any) => put({ done: false, value }),
    end: () => put({ done: true, value: undefined })
  };
}

const adoptFid = "lazy/containers/adopt";
const producer = traceProducer();
beforeAll(() => {
  const marker = { $tr: producer.subscribe(), $ta: 0 };
  document.body.innerHTML =
    '<div id="page">' +
    `<solid-frame data-fid="${adoptFid}" style="display:contents">` +
    "<article><h1>Adopt</h1><ul><!--slot:comment#c1:start-->" +
    '<li class="ssr-fill">server-rendered-fill</li>' +
    "<!--slot:comment#c1:end--></ul></article>" +
    "</solid-frame></div>";
  (window as any)._$HY = {
    done: true,
    r: {
      [`sc:slot:${adoptFid}:comment#c1`]: {
        cid: "c1",
        user: marker,
        filters: { deep: { user: marker } }
      }
    }
  };
});

afterAll(() => {
  delete (window as any)._$HY;
  document.body.innerHTML = "";
});

afterEach(() => vi.unstubAllGlobals());

describe("document face: an adopted record's marker holds the occurrence until the traces tier loads", () => {
  test("held with the server interior on screen, then mounted with the live store (nested references share it)", async () => {
    installServerComponents();
    // Nothing announced, nothing loaded yet.
    expect((tierLoads as any).trace).toBeUndefined();
    expect(getFrameHost().revive).toBeUndefined();
    vi.stubGlobal("fetch", async () => {
      throw new Error("t=0 adoption must not fetch");
    });

    let mounts = 0;
    let same: boolean | undefined;
    const names: string[] = [];
    const Page = dynamic(() => getAdopt() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>shell-fallback</span>}>
          <Page
            comment={(p: any) => {
              mounts++;
              same = untrack(() => p.user === p.filters.deep.user);
              const name = createMemo(() => {
                const v = p.user.name;
                names.push(v);
                return v;
              });
              return (
                <Loading fallback={<i>fill-wait</i>}>
                  <li class="live-fill">{name()}</li>
                </Loading>
              );
            }}
          />
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    // The local answer resolves over microtasks; the module load needs a
    // task. Settle the former only, so the hold is observable.
    const frame = document.querySelector(`[data-fid="${adoptFid}"]`)!;
    for (let i = 0; i < 20; i++) {
      flush();
      await Promise.resolve();
    }
    // Adopted in place (the frame is bound under the call's address — an
    // argless call's address is its function id), and HELD: the sync found
    // the marker and started the load (detection, the un-announced
    // fallback); no fill mounted, the server-rendered interior untouched,
    // the tier still loading.
    expect((tierLoads as any).trace).toBeTruthy();
    expect(traceTierResident()).toBe(false);
    expect(getFrameHost().get(adoptFid)).toBeTruthy();
    expect(frame).not.toBe(null);
    expect(mounts).toBe(0);
    expect(frame.querySelector("li.ssr-fill")!.textContent).toBe("server-rendered-fill");

    // The load settles; the install wires the shared host's reviver and
    // flushes the frame, which re-syncs and mounts the occurrence.
    for (let i = 0; i < 200 && !traceTierResident(); i++) await sleep(10);
    expect(traceTierResident()).toBe(true);
    expect(getFrameHost().revive).toBeTypeOf("function");
    await pump();
    expect(mounts).toBe(1);
    // ONE store for both references; uninitialized until the trace feeds
    // it, so the fill's own boundary covers the read.
    expect(same).toBe(true);
    expect(div.textContent).toContain("fill-wait");

    producer.push({ name: "Ada" });
    await pump();
    expect(div.querySelector("li.live-fill")!.textContent).toBe("Ada");
    expect(names).toEqual(["Ada"]);

    producer.push([[["name"], "Grace"]]);
    await pump();
    expect(div.querySelector("li.live-fill")!.textContent).toBe("Grace");
    expect(names).toEqual(["Ada", "Grace"]);
    expect(mounts).toBe(1);

    producer.end();
    dispose();
    container.remove();
  });
});
