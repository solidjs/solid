/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The frame client's dev-tier range integrity check as a finding: a slot start
// marker whose end marker is missing from its siblings (invalid nesting split
// the range during parsing, or an HTML-rewriting layer removed the comment)
// records `FRAME_MARKER_CORRUPTED` on `OBSERVE.diagnostics` and reports it once
// on the console — the same channel the server's findings ride, so a consumer
// sees the client-detected corruption beside them.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OBSERVE, createRoot, flush, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { createJSONDataTable } from "../serialization/src/serializer.js";
import { createServerReference } from "../server-functions/src/client.js";
import { createChunk } from "../server-functions/src/shared.js";

function frameResponse(id: string, chunks: any[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(createChunk(JSON.stringify(chunk)));
      controller.close();
    }
  });
  return new Response(body, { headers: { "X-Frame-Stream": id } });
}

const settle = () => new Promise(r => setTimeout(r));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (ref: any) => table.resolve(ref)
  });
}

const getStory = createServerReference("story/get-corrupt");

describe("FRAME_MARKER_CORRUPTED", () => {
  let capture: ReturnType<NonNullable<typeof OBSERVE>["diagnostics"]["capture"]>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    installServerComponents(makeHost());
    capture = OBSERVE!.diagnostics.capture();
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    capture.stop();
    error.mockRestore();
    vi.unstubAllGlobals();
  });

  test("a slot range missing its end marker is a finding, reported once", async () => {
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "slot", id: "srv", version: 1, key: "comment#0", args: { text: "hi" } },
        {
          type: "html",
          id: "srv",
          version: 1,
          // The end marker is gone — what a CDN comment-stripper or a <p>
          // nesting split leaves behind.
          html: "<article><ul><!--slot:comment#0:start--></ul></article>"
        },
        { type: "complete", id: "srv", version: 1 }
      ])
    );
    const Story = dynamic(() => getStory(1) as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <Story comment={(p: any) => <li>{p.text}</li>} />
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    const events = capture.events.filter(e => e.code === "FRAME_MARKER_CORRUPTED");
    expect(events.length).toBeGreaterThanOrEqual(1);
    const [event] = events;
    expect(event.kind).toBe("ssr");
    expect(event.severity).toBe("error");
    expect(event.data).toEqual({ slot: "comment#0", end: "slot:comment#0:end" });
    expect(event.message).toContain('Frame slot range "comment#0" is missing its end marker');
    expect(event.message).toContain("Cache-Control: no-transform");
    expect(event.ownerPath).toBeUndefined();
    // One console entry per finding, through the core's console face.
    expect(error).toHaveBeenCalledTimes(events.length);
    expect(String(error.mock.calls[0][0])).toContain("[FRAME_MARKER_CORRUPTED]");

    dispose();
    container.remove();
  });
});
