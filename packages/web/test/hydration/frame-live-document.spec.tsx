/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The document face of a live server component (Stage 8 B3; RFC 11 §9.5,
 * Client face 3) — client half. Replays the chunks
 * test/server/frame-live-document-artifact.spec.tsx wrote (the page showing
 * `dynamic(() => room("a"))` with the room's first value in the markup) and
 * hydrates against the same tree with the CLIENT's source: the live
 * reference.
 *
 * What has to hold:
 *
 *  - t=0 is the document's answer. `dynamic`'s FACTORY memo — the one
 *    consumer of the live source — is not serialized (#3666 serializes the
 *    per-instance value memo, which adopts the call's binding from its
 *    record), so its compute runs during hydration; the live loop's first
 *    call hits the frames intercept (the page holds this call's boundary)
 *    and yields the call's binding without a request — the frame adopts the
 *    SSR'd nodes.
 *    That answer is not a connection: no status is emitted for it and the
 *    iteration holds for its consumer instead of completing.
 *  - The node takes over at its hydration scope's release, exactly as a
 *    serialized live node does: the compute re-runs, the new iteration
 *    yields the adopted binding first (equal — the instance stands), then
 *    connects at the LIVE address. Exactly one request, after hydration.
 *  - The connection's render MORPHS the adopted frame: same `solid-frame`,
 *    same `h1`, same composer `input` with its draft intact; no fallback.
 *  - A death after that reconnects and keeps the instance — the B2 loop,
 *    now starting from adopted content.
 *
 * The `switched` mode (the call's arguments change after adoption) is in
 * frame-live-document-switched.spec.tsx: the frames client's boundary index
 * is module state, so a spec that needs a fresh page gets its own file.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference, live } from "../../server-functions/src/client.js";
import { frameAddress } from "../../server-functions/src/shared.js";
import { makeHost, pump, stubLiveFetch, until } from "../lifecycle-matrix/harness.js";
import { ARGS, REPLAY_MODES, fidFor, makeApp } from "../harness/frame-live-document.jsx";
import { applyChunk, drain, loadArtifact, roomHtml } from "./frame-live-document-helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as any)._$HY;
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

describe("document face — live server component (hydrate + takeover)", () => {
  for (const mode of REPLAY_MODES) {
    const FID = fidFor(mode);
    test(`${mode}: adopts at t=0 without a request, connects once at scope release, morphs the adopted frame, keeps the instance through a death`, async () => {
      const { shell, rest } = loadArtifact(`frame-live-document-${mode}`);
      (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const { host } = makeHost();
      installServerComponents(host);
      const { held, urls } = stubLiveFetch(FID, 2);

      const room = live(createServerReference(FID));
      const status: string[] = [];
      let computes = 0;
      const App = makeApp(() => {
        computes++;
        const src: any = room(...ARGS);
        src.onstatus = (s: string) => status.push(s);
        return src;
      });

      // Every distinct text the page shows, in order: a fallback between two
      // content states is the flash this pins against.
      const shown: string[] = [];
      const observe = () => {
        const text = container.querySelector("main")!.textContent!;
        if (shown[shown.length - 1] !== text) shown.push(text);
      };
      const mo = new MutationObserver(observe);

      applyChunk(container, shell, true);
      if (mode === "loaded") applyChunk(container, rest, false);
      mo.observe(container, { childList: true, subtree: true, characterData: true });
      observe();

      const warnings: string[] = [];
      vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      });
      const dispose = hydrate(() => <App />, container);
      flush();
      await drain();
      observe();

      if (mode === "streamed") {
        // The server's answer is still pending: the fallback is the right
        // UI, and nothing has been requested — the boundary is on its way.
        expect(container.querySelector("h1")).toBeNull();
        expect(container.querySelector("main")!.textContent).toBe("shell-fallback");
        expect(urls).toHaveLength(0);
        applyChunk(container, rest, false);
        observe();
        await drain();
        observe();
      }

      // t=0: the document's markup, adopted — the server's first value is on
      // screen and the composer input is the SSR'd one.
      const frameEl = container.querySelector(`solid-frame[data-fid="${FID}"]`)!;
      const h1 = container.querySelector("h1")!;
      const input = container.querySelector<HTMLInputElement>("input.draft")!;
      expect(frameEl).not.toBeNull();
      expect(h1.textContent).toBe("room v1");
      expect(input).not.toBeNull();
      expect(container.querySelector("main")!.textContent).not.toContain("shell-fallback");

      // The takeover: hydration's scope released → the compute re-ran → the
      // new iteration re-yielded the adopted binding and connected at the
      // LIVE address. Exactly one request, and none before hydration ended.
      await until(() => urls.length === 1);
      expect(urls[0]).toContain("/live/");
      expect(computes).toBe(2);
      // The document's answer was adopted, not connected: no status for it
      // (the adopting node never started that iteration); the connection
      // is the first and only "connected".
      await until(() => status.includes("connected"));
      expect(status).toEqual(["connected"]);
      // The instance stood: same frame, same h1, same input; no fallback.
      expect(container.querySelector("solid-frame")).toBe(frameEl);
      expect(container.querySelector("h1")).toBe(h1);
      expect(container.querySelector("input.draft")).toBe(input);

      // The user types into the adopted composer before the render lands.
      input.value = "draft in progress";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      flush();

      // The connection's render: a MORPH into the adopted frame.
      const address = frameAddress(FID, ARGS);
      held[0].send({ type: "start", id: address, version: 1 });
      held[0].send({ type: "html", id: address, version: 1, html: roomHtml("room v2") });
      await until(() => container.querySelector("h1")!.textContent === "room v2");
      expect(container.querySelector("solid-frame")).toBe(frameEl);
      expect(container.querySelector("h1")).toBe(h1);
      expect(container.querySelector("input.draft")).toBe(input);
      expect(input.value).toBe("draft in progress");
      expect(container.querySelector("main")!.textContent).not.toContain("shell-fallback");

      // Death → reconnect: the loop's B2 story, from adopted content.
      held[0].close();
      await until(() => status.includes("reconnecting"));
      expect(container.querySelector("h1")).toBe(h1);
      await until(() => urls.length === 2);
      held[1].send({ type: "start", id: address, version: 1 });
      held[1].send({ type: "html", id: address, version: 1, html: roomHtml("room v3") });
      await until(() => container.querySelector("h1")!.textContent === "room v3");
      expect(container.querySelector("solid-frame")).toBe(frameEl);
      expect(container.querySelector("input.draft")).toBe(input);
      expect(input.value).toBe("draft in progress");

      // Never a fallback after the content: the page went from the server's
      // markup straight through the morphs.
      const contentStates = shown.filter(s => s.includes("shell-fallback"));
      expect(contentStates.length).toBeLessThanOrEqual(mode === "streamed" ? 1 : 0);
      expect(shown.at(-1)).toContain("room v3");
      expect(warnings.filter(w => w.includes("Hydration key miss"))).toEqual([]);

      mo.disconnect();
      dispose();
      await pump();
      expect(status.at(-1)).toBe("closed");
      container.remove();
    });
  }
});
