/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The HN slice, client half: the collapse UX. Two acceptance behaviors:
//
// 1. Navigation (dispatch case 1): a global client-only `collapsed` signal
//    affects the current story AND future client-side navigated stories —
//    and it never appears in any request.
// 2. Initial load (dispatch case 2, manual form): the document-SSR page
//    already contains the comments AND the client wrappers' markup; slots
//    claim their rendered DOM via ctx.existing (Astro-style opaque slots) —
//    zero hydration data, the page source carries each text once.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, flush, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents, createFrame, createFrameHost } from "../frames/src/client.js";
import { createJSONDataTable } from "../serialization/src/serializer.js";
import { createServerReference } from "../server-functions/src/client.js";
import { createChunk } from "../server-functions/src/shared.js";

const settle = () => new Promise(r => setTimeout(r));

function frameResponse(chunks: any[]) {
  const body = new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(createChunk(JSON.stringify(chunk)));
      c.close();
    }
  });
  return new Response(body, { headers: { "X-Frame-Stream": "srv" } });
}

// Mirrors the wire shape the server half produces (frame-hn.spec.tsx):
// comment occurrences with primitive ids + nested-region children.
function storyResponse(version: number, title: string, texts: string[]) {
  const chunks: any[] = [{ type: "start", id: "srv", version }];
  const markers = texts
    .map((text, i) => {
      chunks.push({ type: "html", id: `srv.${i}`, version, html: `<p>${text}</p>` });
      chunks.push({
        type: "slot",
        id: "srv",
        version,
        key: `comment#${i}`,
        args: { cid: i, children: { $frame: `srv.${i}` } }
      });
      return `<!--slot:comment#${i}:start--><!--slot:comment#${i}:end-->`;
    })
    .join("");
  chunks.push({
    type: "html",
    id: "srv",
    version,
    html: `<article><h1>${title}</h1><section>${markers}</section></article>`
  });
  chunks.push({ type: "complete", id: "srv", version });
  return frameResponse(chunks);
}

describe("HN slice — collapse UX", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("global client-only collapse affects current and future navigated stories", async () => {
    const [story, setStory] = createSignal(1);
    const [collapsed, setCollapsed] = createSignal(false);
    const getStory = createServerReference("hn/story");
    const table = createJSONDataTable();
    installServerComponents(
      createFrameHost({
        applyData: (c: any) => table.apply(c),
        resolve: (r: any) => table.resolve(r)
      })
    );
    // Everything the "server" ever sees is the request itself: the story id
    // in the codec-encoded args, and nothing else.
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (_base: any, init: any) => {
      const id = JSON.parse(String(init.body))[0];
      requests.push(`story=${id}`);
      return id === 1
        ? storyResponse(1, "One", ["alpha-text", "beta-text"])
        : storyResponse(2, "Two", ["gamma-text"]);
    });
    const Story = dynamic(() => getStory(story()) as any);

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <Story
            comment={(p: any) => {
              const wrap = document.createElement("div");
              wrap.className = "comment";
              // Global collapse read at mount; per-comment toggle overrides.
              if (collapsed()) wrap.classList.add("collapsed");
              const btn = document.createElement("button");
              btn.addEventListener("click", () => wrap.classList.toggle("collapsed"));
              wrap.append(btn, p.children);
              return wrap;
            }}
          />
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    expect(div.querySelectorAll(".comment").length).toBe(2);
    expect(div.querySelectorAll(".collapsed").length).toBe(0);

    // Per-comment override is pure client state.
    (div.querySelector(".comment button") as HTMLElement).click();
    expect(div.querySelectorAll(".collapsed").length).toBe(1);

    // Flip the global toggle, then navigate: the new story's comments mount
    // collapsed. The signal lives only in this closure — the request log
    // proves the server only ever saw story ids.
    setCollapsed(true);
    setStory(2);
    flush();
    await settle();
    flush();
    await settle();
    expect(div.querySelector("h1")!.textContent).toBe("Two");
    const comments = div.querySelectorAll(".comment");
    expect(comments.length).toBe(1);
    expect(comments[0].classList.contains("collapsed")).toBe(true);
    expect(requests).toEqual(["story=1", "story=2"]);

    dispose();
    container.remove();
  });

  test("initial document load: adopt + claim, zero data, page source has each text once", async () => {
    // What the document renderer would have produced: server html with the
    // client wrappers' output already rendered inside the slot ranges.
    const page =
      "<article><h1>One</h1><section>" +
      '<!--slot:comment#0:start--><div class="comment"><button></button>' +
      "<!--frame:srv.0:start--><p>alpha-text</p><!--frame:srv.0:end-->" +
      "</div><!--slot:comment#0:end-->" +
      "</section></article>";
    // The case-2 invariant on the page itself: one occurrence, and there is
    // no hydration payload at all for this content.
    expect(page.split("alpha-text").length).toBe(2);

    const boundary = document.createElement("div");
    document.body.appendChild(boundary);
    boundary.innerHTML = page;
    const ssrButton = boundary.querySelector("button")!;

    const host = createFrameHost();
    createFrame(boundary, {
      host,
      id: "hn",
      adopt: true,
      slots: {
        comment: (_p: any, ctx: any) => {
          // Claim the server-rendered wrapper; bind behavior onto it. No
          // props arrived — and none were needed.
          const wrap = ctx.existing[0] as HTMLElement;
          wrap.querySelector("button")!.addEventListener("click", () => {
            wrap.classList.toggle("collapsed");
          });
          return undefined;
        }
      }
    });

    // Same nodes (no re-render), behavior live.
    expect(boundary.querySelector("button")).toBe(ssrButton);
    expect(boundary.textContent!.split("alpha-text").length).toBe(2);
    (ssrButton as HTMLElement).click();
    expect(boundary.querySelector(".comment")!.classList.contains("collapsed")).toBe(true);
    boundary.remove();
  });
});
