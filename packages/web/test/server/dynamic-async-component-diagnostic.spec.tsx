/**
 * @jsxImportSource @solidjs/web
 */
// DYNAMIC_ASYNC_COMPONENT (#3666): an async dynamic() instance is an ordinary
// async memo whose landing serializes for the client to adopt. Three landings
// exist. A server component crosses as a flight reference; a tag name is a
// value; a CLIENT COMPONENT FUNCTION has no encoding — an unguarded record
// would leave the client's memo pending forever, and the pre-#3666 fallback
// (the client re-running the source under a <Loading>) IS the reported bug.
// So the server refuses it at the point the memo would serialize it: the
// finding is recorded and the memo rejects with the message, which the
// enclosing <Errored> / `onError` contains like any render error.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Errored, Loading, dynamic, renderToStream } from "@solidjs/web";
import { OBSERVE, type DiagnosticEvent } from "solid-js";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";

let capture: ReturnType<NonNullable<typeof OBSERVE>["diagnostics"]["capture"]>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  capture = OBSERVE!.diagnostics.capture();
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  capture.stop();
  error.mockRestore();
});
const byCode = (code: DiagnosticEvent["code"]) => capture.events.filter(e => e.code === code);

const tick = <T,>(value: T) => new Promise<T>(r => setTimeout(() => r(value), 5));

async function render(code: () => any) {
  const errors: unknown[] = [];
  const html = await renderToStream(code, {
    plugins: [ServerComponentPlugin],
    onError: (e: unknown) => errors.push(e)
  });
  return { html, errors };
}

describe("DYNAMIC_ASYNC_COMPONENT", () => {
  test("a client component function lands as the finding and a rejection, contained by <Errored>", async () => {
    function Editor() {
      return <b>editor</b>;
    }
    const Page = dynamic(() => tick(Editor));
    const { html, errors } = await render(() => (
      <Loading fallback={<span>loading</span>}>
        <Errored fallback={<i>caught</i>}>
          <Page />
        </Errored>
      </Loading>
    ));

    const [finding, ...rest] = byCode("DYNAMIC_ASYNC_COMPONENT");
    expect(rest).toHaveLength(0);
    expect(finding.kind).toBe("ssr");
    expect(finding.severity).toBe("error");
    expect(finding.data).toEqual({ component: "Editor" });
    expect(finding.message).toBe(
      "[DYNAMIC_ASYNC_COMPONENT] An async dynamic() source resolved to a client component " +
        "function, which cannot be serialized for hydration: the client would re-run the source " +
        "and wait on it while hydrating, committing the enclosing <Loading> to a fallback the " +
        "server never rendered. Resolve the async upstream — a createAsync()/createMemo() the " +
        "source reads synchronously (`dynamic(() => page() ? Editor : Viewer)`) — or use lazy() " +
        "for a code-split component. A source may stay async when it resolves to a server " +
        "component or a serializable value (a tag name)."
    );

    // The memo REJECTS (not warn-and-render): the component never renders
    // and the boundary shows its fallback; the rejection is the finding's
    // message, and nothing else reached `onError`.
    expect(html).not.toContain("editor");
    expect(html).toMatch(/<i[^>]*>caught<\/i>/);
    expect(errors.map(e => String(e))).toEqual([`Error: ${finding.message}`]);
    // Recorded, not reported by the diagnostic itself: the one console entry
    // is <Errored>'s containment wiring, carrying the thrown message.
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(
      /^\[SSR_RENDER_ERROR_CONTAINED\] .*\[DYNAMIC_ASYNC_COMPONENT\]/
    );
  });

  test("uncontained, the rejection reaches onError", async () => {
    const Page = dynamic(() => tick(() => <b>editor</b>));
    const { html, errors } = await render(() => (
      <Loading fallback={<span>loading</span>}>
        <Page />
      </Loading>
    ));
    expect(html).not.toContain("editor");
    expect(errors.map(e => String(e))).toEqual([
      expect.stringContaining("[DYNAMIC_ASYNC_COMPONENT]")
    ]);
    expect(byCode("DYNAMIC_ASYNC_COMPONENT")).toHaveLength(1);
  });

  test("a server component is the shape that crosses — no finding", async () => {
    const Article = frameTransformDirectResult(() => <b>article</b>, {
      id: "diag/article",
      args: []
    });
    const Page = dynamic(() => tick(Article));
    const { html, errors } = await render(() => (
      <Loading fallback={<span>loading</span>}>
        <Page />
      </Loading>
    ));
    expect(html).toContain("<b>article</b>");
    expect(errors).toEqual([]);
    expect(byCode("DYNAMIC_ASYNC_COMPONENT")).toHaveLength(0);
  });

  test("a tag name is a value — no finding", async () => {
    const Tag = dynamic(() => tick("article" as const));
    const { html, errors } = await render(() => (
      <Loading fallback={<span>loading</span>}>
        <Tag>body</Tag>
      </Loading>
    ));
    expect(html).toContain("<article");
    expect(html).toContain("body</article>");
    expect(errors).toEqual([]);
    expect(byCode("DYNAMIC_ASYNC_COMPONENT")).toHaveLength(0);
  });

  test("a sync source is untouched: a client component function renders, nothing serializes", async () => {
    let records = 0;
    const Page = dynamic(() => () => <b>viewer</b>);
    const html = await renderToStream(() => (
      <Loading fallback={<span>loading</span>}>
        <Page />
      </Loading>
    ));
    for (const _ of html.matchAll(/_\$HY\.r\[/g)) records++;
    expect(html).toMatch(/<b[^>]*>viewer<\/b>/);
    expect(records).toBe(0);
    expect(byCode("DYNAMIC_ASYNC_COMPONENT")).toHaveLength(0);
  });
});
