/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Lifecycle matrix — mount kind: PLACEHOLDER MOUNT. A `self._$SC.r(id)`
// placeholder rendered with NO call in flight and NO SSR'd boundary in the
// page mounts a fresh client frame bound to the function id (the argless
// address); a later stream under that id fills it, and later versions morph
// it — exactly the non-document path. (The "document still streaming, wait
// for the swap" flavor of a missing boundary is pinned in
// test/frames-late-boundary-client.spec.tsx.)
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, flush, Loading } from "solid-js";
import { installServerComponents } from "../../frames/src/client.js";
import { makeHost, pump } from "./harness.js";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("placeholder/fill-by-later-stream", () => {
  test("a placeholder mount with no call in flight mounts an empty frame; a later stream fills it, arms its slots, and later versions morph it", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    // No call ever leaves: the stream arrives by other means (e.g. pushed).
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called for a placeholder mount");
    });

    const FID = "matrix/ph/feed";
    const Feed = (window as any)._$SC.r(FID);
    let mounts = 0;
    let bump!: () => void;

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>shell-fallback</span>}>
          <Feed
            comment={(p: any) => {
              mounts++;
              const [n, setN] = createSignal(0);
              bump = () => setN(n() + 1);
              return (
                <li>
                  {p.text}:{n()}
                </li>
              );
            }}
          />
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    await pump();

    // Mounted and bound under the function id, waiting empty.
    const frameEl = div.querySelector(`solid-frame[data-fid="${FID}"]`)!;
    expect(frameEl).toBeTruthy();
    expect(frameEl.textContent).toBe("");
    expect(mounts).toBe(0);

    // The stream arrives and fills the waiting boundary.
    host.apply({ type: "slot", id: FID, version: 1, key: "comment#0", args: { text: "one" } });
    host.apply({
      type: "html",
      id: FID,
      version: 1,
      html: "<article><h1>Feed</h1><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul></article>"
    });
    host.apply({ type: "complete", id: FID, version: 1 });
    await pump();

    expect(frameEl.querySelector("h1")!.textContent).toBe("Feed");
    expect(mounts).toBe(1);
    bump();
    flush();
    const li = frameEl.querySelector("ul li")! as HTMLElement;
    expect(li.textContent).toBe("one:1");

    // A newer version morphs in place: slot state survives, dedupe holds.
    host.apply({ type: "slot", id: FID, version: 2, key: "comment#0", args: { text: "one" } });
    host.apply({
      type: "html",
      id: FID,
      version: 2,
      html: "<article><h1>Feed 2</h1><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul></article>"
    });
    await pump(1);
    expect(frameEl.querySelector("h1")!.textContent).toBe("Feed 2");
    expect(mounts).toBe(1);
    expect(frameEl.querySelector("ul li")).toBe(li);
    expect(li.textContent).toBe("one:1");

    dispose();
    container.remove();
  });
});
