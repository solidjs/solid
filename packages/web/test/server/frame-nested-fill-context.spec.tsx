/**
 * @jsxImportSource @solidjs/web
 */
// Context through nested slot fills — server half. A fill placed inside the
// server content an enclosing fill renders sees that fill's context, as in
// any client tree. Writes the artifact
// test/hydration/frame-nested-fill-context*.spec.tsx hydrate.
import { describe, expect, test } from "vitest";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import { ARGS, FID, makeApp, makePageComponent } from "../harness/frame-nested-fill-context.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

const markup = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");
const badge = (html: string, id: string) =>
  html.match(new RegExp(`id="badge-${id}"[^>]*>(.*?)</button>`))?.[1].replace(/<!--.*?-->/g, "");

describe("document face — context through nested slot fills — server render", () => {
  test("the nested fill reads the enclosing fill's provider; one outside reads the default", async () => {
    const Inline = frameTransformDirectResult(makePageComponent(), { id: FID, args: ARGS }) as any;
    const App = makeApp(() => Promise.resolve(Inline));
    const { shell, rest } = await recordStream(() => <App />, {
      plugins: [ServerComponentPlugin]
    } as any);
    const html = markup(shell + rest);
    expect(badge(html, "in")).toBe("dark:0");
    expect(badge(html, "out")).toBe("default:0");
    // The panel placed its content: markup, not an occluded region record.
    expect(html).toContain(`data-fid="${FID}.panel#0.children"`);
    expect(shell + rest).not.toContain(`sc:region:${FID}.panel#0.children`);
    // An open drawer's badge reads the drawer's theme; a closed drawer's
    // content is an occluded region record, never markup.
    expect(badge(html, "d1")).toBe("drawer:0");
    expect(html).not.toContain("badge-d2");
    expect(shell + rest).toContain(`sc:region:${FID}.drawer#1.children`);
    writeArtifact("frame-nested-fill-context", { name: "frame-nested-fill-context", shell, rest });
  });
});
