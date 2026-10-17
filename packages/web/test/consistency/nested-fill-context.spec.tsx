/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Context through nested slot fills, stream face. A fill in a region — server
 * content an enclosing fill places — is that fill's child, as in any client
 * tree: it reads the context the enclosing fill provides where it placed the
 * region. That holds for an occurrence a live hole's patch adds to the region
 * later, as for those the region arrived with. (The document face, adopted
 * and deferred: test/hydration/frame-nested-fill-context*.spec.tsx.)
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createContext, createRoot, flush, Loading, useContext } from "solid-js";
import { dynamic } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { prepareTier } from "../../frames/src/frame-client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { freshFid, holeHtml, makeHost, pump, slotRange, stubHeldFetch } from "./support.js";

beforeAll(() => prepareTier("regions"));
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const Theme = createContext("default");

describe("context through nested slot fills — stream face", () => {
  test("a nested fill reads the enclosing fill's provider, a live hole's new one too", async () => {
    const id = freshFid("nested-ctx");
    const { host } = makeHost();
    installServerComponents(host);
    const { held } = stubHeldFetch([id]);
    const getX = createServerReference(id);
    const Site = dynamic(() => getX() as any);
    let div!: HTMLDivElement;
    disposers.push(
      createRoot(d => {
        <div ref={div}>
          <Loading fallback={<span>fallback</span>}>
            <Site
              panel={(p: any) => (
                <Theme value="dark">
                  <section>{p.children}</section>
                </Theme>
              )}
              badge={(p: any) => (
                <b>
                  {p.text}={useContext(Theme)}
                </b>
              )}
            />
          </Loading>
        </div>;
        document.body.appendChild(div);
        return d;
      })
    );
    await pump();
    const region = `${id}.panel#0.children`;
    const send = (c: any) => held[0].send({ id, version: 1, ...c });
    send({ type: "start" });
    send({ type: "slot", key: "panel#0", args: { children: { $frame: region } } });
    send({ type: "slot", key: "badge#0", args: { text: "a" } });
    send({ type: "slot", key: "badge#1", args: { text: "out" } });
    send({ type: "html", html: `<div>${slotRange("panel#0")}${slotRange("badge#1")}</div>` });
    send({ type: "html", id: region, html: `<p>${holeHtml(0, slotRange("badge#0"))}</p>` });
    await pump();
    const texts = () => [...div.querySelectorAll("b")].map(b => b.textContent);
    expect(texts()).toEqual(["a=dark", "out=default"]);

    send({ type: "slot", key: "badge#2", args: { text: "c" } });
    send({
      type: "hole",
      id: region,
      key: "lh:0",
      html: slotRange("badge#0") + slotRange("badge#2")
    });
    await pump();
    expect(texts()).toEqual(["a=dark", "c=dark", "out=default"]);
  });
});
