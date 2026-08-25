/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Adopted claims derive their prefix from the WIRE id, not the call address.
 *
 * The identity split binds an adopted frame to the call's address — function
 * id + args hash — but the document producer stamped `_hk` keys under the
 * wire name, the bare function id (`createDocumentSlotProps` scopes every
 * occurrence as `sc-<frameId>-<occurrence>-`). The claim prefix must derive
 * from what the producer wrote: adoptBoundary threads the wire id down as
 * `claimScope`. Without it, every adopted claim on an args-BEARING call
 * (address !== id) derives a ':hash'-suffixed prefix, misses the registry,
 * and re-renders fresh clones whose inserts cannibalize the server DOM —
 * streamed content flashed on screen and went blank at hydration (#2973).
 *
 * Argless calls (address === id) mask the break, which is why the
 * adopted-slot suites never caught it: this spec pins the args-bearing case
 * by seeding an `_$SC.a` address record so the adopted frame binds a
 * hash-suffixed address while the markup's `_hk` keys carry the wire id.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents, createFrameHost } from "../../frames/src/client.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";

const settle = () => new Promise(r => setTimeout(r));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r)
  });
}

const FID = "claims/args";
// The call's address as the hydration references record it: function id +
// args hash. Content keys under this; the page's `_hk` chains do NOT.
const ADDRESS = `${FID}:x9zzy`;

describe("adopted claim scope on an args-bearing call", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any)._$HY;
    delete (globalThis as any)._$SC;
    document.body.innerHTML = "";
  });

  test("the fill claims the producer's server-rendered node instead of re-rendering a clone", async () => {
    // The document as the server left it: the producer stamped the fill's
    // wrapper with an `_hk` chained from the WIRE id occurrence scope.
    const container = document.createElement("div");
    container.innerHTML =
      `<dx-frame data-fid="${FID}" style="display:contents">` +
      "<article><!--slot:comment#c1:start-->" +
      `<div class="comment" _hk="sc-${FID}-comment#c1-0"><button>[-]</button></div>` +
      "<!--slot:comment#c1:end--></article>" +
      "</dx-frame>";
    document.body.appendChild(container);
    (globalThis as any)._$HY = {
      events: [],
      completed: new WeakSet(),
      r: { [`sc:slot:${FID}:comment#c1`]: { cid: "c1" } },
      fe() {}
    };
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    installServerComponents(makeHost());
    // The args-bearing call's address record (`_$SC.a`, address -> id), as
    // the document's hydration references would have written it. This is
    // what splits address from wire id: documentAddress() resolves the
    // frame's store to ADDRESS while the page's keys stay under FID.
    (globalThis as any)._$SC.a = { [ADDRESS]: FID };

    const ssrNode = container.querySelector(".comment")!;
    const ssrButton = ssrNode.querySelector("button")!;

    const seen: any[] = [];
    const Thread = (globalThis as any)._$SC.r(FID);
    const dispose = hydrate(
      () => (
        <Thread
          comment={(p: any) => {
            seen.push(p.cid);
            return (
              <div class="comment">
                <button>[-]</button>
              </div>
            );
          }}
        />
      ),
      container
    );
    flush();
    await settle();
    flush();

    // The occurrence was invoked with the drained t=0 record's args...
    expect(seen).toEqual(["c1"]);
    // ...and the claim landed: the server-rendered wrapper and its interior
    // are still THE nodes in the document. A prefix derived from the address
    // misses the registry, renders fresh clones, and replaces (or blanks)
    // the range instead.
    const nowNode = container.querySelector(".comment");
    expect(nowNode).toBe(ssrNode);
    expect(container.querySelector("button")).toBe(ssrButton);
    expect(document.querySelectorAll(".comment").length).toBe(1);

    dispose();
    container.remove();
  });
});
