/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of #3932. Three calls of one server function, each with its
 * own argument, each answering with its own component. Writes the artifact
 * the hydration spec replays.
 */
import { describe, expect, test } from "vitest";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import { ARTIFACT, FID, TEXTS, makeApp } from "../harness/multicall-hydration-3932.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");

describe("three calls of one server function (#3932) — server render", () => {
  test("each argument renders its own block, under its own site id", async () => {
    const render = (text: string) =>
      Promise.resolve(
        frameTransformDirectResult(() => <p class="block">{text}</p>, { id: FID, args: [text] })
      );
    const App = makeApp(render);
    const { shell, rest } = await recordStream(() => <App />, {
      plugins: [ServerComponentPlugin]
    } as any);
    const full = shell + rest;
    const visible = visibleText(full);

    expect(visible).not.toContain("loading");
    for (const text of TEXTS) expect(visible).toContain(text);
    expect(full.match(/class="block"/g)?.length).toBe(3);
    expect(full.match(/<solid-frame\b/g)?.length).toBe(3);
    // The first site keeps the function id. Each later call stamps its own.
    expect(full).toContain(`data-fid="${FID}"`);
    expect(full).toContain(`data-fid="${FID}~2"`);
    expect(full).toContain(`data-fid="${FID}~3"`);

    writeArtifact(ARTIFACT, { name: ARTIFACT, shell, rest });
  });
});
