/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment node
 */
// The HN-shaped acceptance slice, server half: a server function returns a
// recursive comments component; navigation fetches stream through the REAL
// server-function handler as frame responses; the client wraps each comment
// (collapse UI) around server-owned nested regions it never re-renders.
//
// The headline assertion is made at its strongest: the RAW WIRE BYTES of a
// story response contain each comment's text exactly once — no double
// serialization between html and slot args (transport dispatch case
// 1) — and the request carries only the story id (client collapse state is
// server-invisible).
import { describe, expect, it } from "vitest";
// @ts-expect-error jsdom ships no types; used only to fabricate a document
import { JSDOM } from "jsdom";
globalThis.document = new JSDOM("<body></body>").window.document;

import { frameTransformResult } from "../../frames/src/frame-sink.js";
import { applyFrameResponse, isFrameStreamResponse } from "../../frames/src/frame-transport.js";
import {
  INSTANCE_HEADER,
  handleServerFunctionRequest,
  registerServerFunction
} from "../../server-functions/src/server.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";
import { createFrame, createFrameHost } from "../../frames/src/frame-client.js";

type CommentData = { id: number; text: string; replies: CommentData[] };

const STORIES: Record<string, { title: string; comments: CommentData[] }> = {
  "1": {
    title: "Show HN: Lakes, not islands",
    comments: [
      {
        id: 1,
        text: "solar-powered-dishwasher",
        replies: [
          { id: 2, text: "quantum-toaster-reply", replies: [] },
          {
            id: 3,
            text: "artisanal-modem-noises",
            replies: [{ id: 4, text: "deeply-nested-take", replies: [] }]
          }
        ]
      },
      { id: 5, text: "second-root-comment", replies: [] }
    ]
  },
  "2": {
    title: "Ask HN: Frames?",
    comments: [{ id: 6, text: "completely-different-thread", replies: [] }]
  }
};

// The server component a `use server` function would return: recursive
// comments where each comment is a CLIENT position (props.comment) whose
// children — text and replies — are SERVER content flowing as a nested
// region. Text ships in html, once, by construction. Slots with args render
// as JSX — render callbacks included — never as calls, which evaluate their
// args eagerly in the component body (argless slots are plain prop access).
registerServerFunction("getStory", async (storyId: string) => {
  const story = STORIES[storyId];
  return (props: any) => {
    const renderComment = (c: CommentData): any => (
      <props.comment cid={c.id}>
        <div class="body">
          <p>{c.text}</p>
          {c.replies.map(renderComment)}
        </div>
      </props.comment>
    );
    return (
      <article>
        <h1>{story.title}</h1>
        <section class="comments">{story.comments.map(renderComment)}</section>
      </article>
    );
  };
});

function fetchStory(storyId: string) {
  return handleServerFunctionRequest(
    new Request("http://localhost/_server/getStory", {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        [INSTANCE_HEADER]: "1",
        "Content-Type": "text/plain",
        "X-Server-Function-Format": "1"
      },
      body: storyId
    }),
    { transformResult: frameTransformResult, provideEvent: (_e: any, fn: any) => fn() }
  );
}

const ALL_TEXTS = [
  "solar-powered-dishwasher",
  "quantum-toaster-reply",
  "artisanal-modem-noises",
  "deeply-nested-take",
  "second-root-comment"
];

describe("HN slice — the no-double-serialization proof over the real wire", () => {
  it("streams a recursive story; every comment text crosses the wire exactly once", async () => {
    const response = await fetchStory("1");
    expect(isFrameStreamResponse(response)).toBe(true);

    // THE assertion, on raw bytes: view-source of the payload finds each
    // comment once. No hidden second copy in any data record.
    const wire = await response.clone().text();
    for (const text of ALL_TEXTS) {
      expect(wire.split(text).length).toBe(2);
    }
    // And the collapse model's data needs are met by primitives riding the
    // slot chunks — no codec data records at all in this story's stream.
    expect(wire).not.toContain('"type":"data"');

    // Consume with the collapse-wrapper client: each comment wraps its
    // server-owned region; a per-comment toggle is pure client state.
    const table = createJSONDataTable();
    const host = createFrameHost({
      applyData: (c: any) => table.apply(c),
      resolve: (ref: any) => table.resolve(ref)
    });
    const boundary = document.createElement("div");
    document.body.appendChild(boundary);
    createFrame(boundary, {
      host,
      id: "story-pane",
      slots: {
        comment: (p: any) => {
          const wrap = document.createElement("div");
          wrap.className = "comment";
          wrap.dataset.cid = String(p.cid);
          const toggle = document.createElement("button");
          toggle.className = "collapse";
          toggle.addEventListener("click", () => wrap.classList.toggle("collapsed"));
          wrap.append(toggle, p.children);
          return wrap;
        }
      }
    });
    await applyFrameResponse(response, host, { as: "story-pane" });

    // Full recursion materialized, client wrappers around server bodies.
    expect(boundary.querySelector("h1")!.textContent).toBe("Show HN: Lakes, not islands");
    const nested = boundary.querySelector('.comment[data-cid="3"] .comment[data-cid="4"] p')!;
    expect(nested.textContent).toBe("deeply-nested-take");
    expect(boundary.querySelectorAll(".comment").length).toBe(5);
    // Texts appear once in the DOM too (no duplicate mounts from the
    // parent/child discovery split).
    expect(boundary.textContent!.split("deeply-nested-take").length).toBe(2);

    boundary.remove();
  });

  it("navigation morphs the same boundary; requests never carry client state", async () => {
    const host = createFrameHost();
    const boundary = document.createElement("div");
    document.body.appendChild(boundary);
    createFrame(boundary, {
      host,
      id: "story-pane",
      slots: {
        comment: (p: any) => {
          const wrap = document.createElement("div");
          wrap.className = "comment collapsed-by-default";
          wrap.appendChild(p.children);
          return wrap;
        }
      }
    });

    const first = await fetchStory("1");
    await applyFrameResponse(first, host, { as: "story-pane" });
    const article = boundary.querySelector("article")!;
    expect(boundary.querySelectorAll(".comment").length).toBe(5);

    const second = await fetchStory("2");
    // The request that produced this carried only the story id — grep-proof
    // that collapse state (or anything client-side) never reached the server
    // is structural: the body was the literal string "2".
    const wire2 = await second.clone().text();
    expect(wire2.split("completely-different-thread").length).toBe(2);
    await applyFrameResponse(second, host, { as: "story-pane" });

    // Same boundary element morphs in place (policy A at the story level).
    expect(boundary.querySelector("article")).toBe(article);
    expect(boundary.querySelector("h1")!.textContent).toBe("Ask HN: Frames?");
    expect(boundary.querySelectorAll(".comment").length).toBe(1);
    boundary.remove();
  });
});
