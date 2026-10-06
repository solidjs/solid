/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Can the client refetch a server component whose response errored? (The
// maintainer's question, 2026-10-06; frames-rulings 3.3.) The non-SC rule:
// `reset` re-creates an `<Errored>`'s children, so an async node under it
// re-asks by construction. For a frame the content node is the mount's
// `landing(address)` — the frame as one async value outward (A0, corollary
// 4) — cached per address in the host. The rule under A0: an errored
// landing is not a landing for a fresh consumer — a re-read after `reset`
// starts a new flight (a version bump) for the same address.
//
// Pinned RED (2026-10-06, A6). It fails at its first step: the client
// <Errored> never catches. What it would take, in order:
//
//  1. The outward face — the frame's `:error` must REJECT the landing:
//     `createFrameHost.apply` settles the address's landing on an `:error`
//     write by rejecting it (today it resolves: "the root, the stream's
//     error, or its completion" all resolve, default #1), and `client.ts`'s
//     `landing()` memo then throws into the enclosing <Errored> as any async
//     node does. The `call-driven/error-record` pins ("the boundary mounts
//     EMPTY, not stuck on fallback") assert today's reading and would
//     re-pin to the ruling's (an un-boundaried frame error surfaces).
//  2. The re-ask — `reset` re-creates the children, but the CALL lives in
//     `dynamic`'s hoisted factory memo (computed once; the re-created
//     instance reads the same binding), so no request is made by
//     construction; and `host.landing(address)` reads the errored store as
//     warm (`shown` set) — a fresh consumer sees the error synchronously.
//     The rule needs the host to answer an errored `shown` with a NEW
//     flight for a fresh consumer: a per-address re-invoke the handler
//     records at `handle` (it has `ctx.id` / `ctx.args` there; the address
//     alone is a one-way hash) and the landing calls, bumping the version.
//     That is `frame-transport.ts` (the handler), `frame-client.ts` (the
//     host's `landing`), `client.ts` (`landing`) and the server-functions
//     client's handler context — not the one-line `landing` rule, so it is
//     left described, not built, in A6.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Errored, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents } from "../frames/src/client.js";
import { createServerReference } from "../server-functions/src/client.js";
import { frameAddress } from "../server-functions/src/shared.js";
import { makeHost, frameResponse, pump } from "./lifecycle-matrix/harness.js";

const html = (text: string) => `<article><p>${text}</p></article>`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("refetch after a client <Errored> caught the frame's error", () => {
  test.fails(
    "(a) the frame errors → the client <Errored> catches → reset() → a new request, the new content shows",
    async () => {
      const { host } = makeHost();
      installServerComponents(host);
      let call = 0;
      vi.stubGlobal("fetch", async () => {
        call++;
        return call === 1
          ? frameResponse("srv", [
              { type: "start", id: "srv", version: 1 },
              { type: "error", id: "srv", version: 1, error: { message: "boom" } }
            ])
          : frameResponse("srv", [
              { type: "start", id: "srv", version: 1 },
              { type: "html", id: "srv", version: 1, html: html("recovered") },
              { type: "complete", id: "srv", version: 1 }
            ]);
      });
      const getStory = createServerReference("frames-reset/story");
      const Page = dynamic(() => getStory() as any);
      let resetFn: (() => void) | undefined;
      const container = document.createElement("div");
      document.body.appendChild(container);
      let div!: HTMLDivElement;
      const dispose = createRoot(d => {
        <div ref={div}>
          <Errored
            fallback={(err, reset) => {
              resetFn = reset;
              return <span class="err">failed: {(err() as any)?.message}</span>;
            }}
          >
            <Loading fallback={<span>shell-fallback</span>}>
              <Page />
            </Loading>
          </Errored>
        </div>;
        container.appendChild(div);
        return d;
      });
      await pump();

      // STEP 1 — the frame's `:error` is the enclosing client <Errored>'s
      // to catch (the frame as one errored async value, 3.3's outward
      // face). Observed on this branch: it is NOT — `landing()` resolves
      // on the error write (frames-rulings default #1: the landing is "the
      // root, the stream's error, or its completion"), the covering
      // <Loading> releases over an EMPTY <solid-frame>, `frame.error` holds
      // the record and nothing throws it outward (call-driven-lifecycle's
      // "error/before-html" pins exactly this: "the boundary mounts empty").
      const frame: any = host.get(frameAddress("frames-reset/story"));
      expect(frame.error).toEqual({ message: "boom" });
      expect(call).toBe(1);
      expect(div.querySelector(".err")).not.toBeNull();
      expect(div.querySelector(".err")!.textContent).toBe("failed: boom");

      // STEP 2 — `reset` re-creates the children: the frame's node re-asks.
      resetFn!();
      await pump();
      expect(call).toBe(2);
      expect(div.querySelector("p")!.textContent).toBe("recovered");
      expect(div.querySelector(".err")).toBeNull();

      dispose();
      container.remove();
    }
  );
});
