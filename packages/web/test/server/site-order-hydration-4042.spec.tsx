/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of #4042. The preview's site sits behind async setup, so the
 * server mints its site id after the docs site's. Writes the artifact the
 * hydration spec replays.
 */
import { describe, expect, test } from "vitest";
import { Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import { frameAddress } from "../../server-functions/src/shared.js";
import { ARTIFACT, FID, makeApp } from "../harness/site-order-hydration-4042.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

describe("sites minted out of mount order (#4042) — server render", () => {
  test("each frame carries the hash of its call's arguments", async () => {
    const render = (text: string) =>
      Promise.resolve(
        frameTransformDirectResult(() => <p class="block">{text}</p>, { id: FID, args: [text] })
      );
    const App = makeApp(render);
    const { shell, rest } = await recordStream(() => <App />, {
      plugins: [ServerComponentPlugin]
    } as any);
    const full = shell + rest;
    writeArtifact(ARTIFACT, { name: ARTIFACT, shell, rest });
    const frames = [...full.matchAll(/<solid-frame\b[^>]*>/g)].map(m => m[0]);
    expect(frames.length).toBe(2);
    // Visual order is preview then docs, but the preview's id was minted second.
    expect(frames[0]).toContain(`data-fid="${FID}~2"`);
    expect(frames[1]).toContain(`data-fid="${FID}"`);
    const hash = (text: string) => frameAddress(FID, [text]).slice(FID.length + 1);
    expect(frames[0]).toContain(`data-fa="${hash("preview original")}"`);
    expect(frames[1]).toContain(`data-fa="${hash("documentation")}"`);
  });

  test("an argless call stamps no address", async () => {
    const render = () =>
      Promise.resolve(frameTransformDirectResult(() => <p>plain</p>, { id: "argless-4042" }));
    function App() {
      const Content = dynamic(() => render());
      return (
        <Loading fallback="loading">
          <Content />
        </Loading>
      );
    }
    const { shell, rest } = await recordStream(() => <App />, {
      plugins: [ServerComponentPlugin]
    } as any);
    expect(shell + rest).toContain(`data-fid="argless-4042"`);
    expect(shell + rest).not.toContain("data-fa=");
  });
});
