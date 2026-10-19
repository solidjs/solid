/**
 * @jsxImportSource @solidjs/web
 */
// Dependency edges — server half. Each document frame ships which slot
// occurrences read which plain signals they did not create, as a per-frame
// aggregate (`sc:deps:<site>:<n>`, `sid -> "item#0-3"`), plus the signals
// whose readers it could not track (`*`) and the occurrences with reads it
// could not see (`!`). Writes the artifact
// test/hydration/frame-dependency-edges.spec.tsx hydrates.
import { describe, expect, test } from "vitest";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import { ARGS, FID, makeApp, makePageComponent } from "../harness/frame-dependency-edges.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

/** The frame's `sc:deps` records, in order. */
function depsRecords(html: string, site: string): Record<string, string>[] {
  const key = `_$HY.r["sc:deps:${site}:`;
  const out: Record<string, string>[] = [];
  for (let at = html.indexOf(key); at >= 0; at = html.indexOf(key, at + 1)) {
    const open = html.indexOf("{", at);
    out.push(JSON.parse(html.slice(open, html.indexOf("}", open) + 1)));
  }
  return out;
}

describe("document face — dependency edges — server render", () => {
  test("the frame ships its fills' reads of shell signals as one aggregate record", async () => {
    const Inline = frameTransformDirectResult(makePageComponent(), { id: FID, args: ARGS }) as any;
    const App = makeApp(() => Promise.resolve(Inline));
    const { shell, rest } = await recordStream(() => <App />, {
      plugins: [ServerComponentPlugin]
    } as any);
    const records = depsRecords(shell + rest, FID);
    expect(records.length).toBe(1);
    const deps = records[0];
    // The shell's three plain signals and its plain store, named in creation
    // order under one owner.
    const named = Object.keys(deps).filter(k => k !== "*" && k !== "!");
    const owner = named[0].slice(0, named[0].lastIndexOf("~"));
    const [cart, currency, wideSource, store] = [0, 1, 2, 3].map(n => `${owner}~${n}`);
    // `currency`: every item (one run); `cart`: the cart widget only (the
    // late widget reads it through a client-source memo the server never runs).
    expect(deps[currency]).toBe("item#0-3");
    expect(deps[cart]).toBe("cart#0");
    // The store, by its root's name: the store widget read it.
    expect(deps[store]).toBe("store#0");
    // A projection read `wideSource`: its readers are not tracked.
    expect(deps["*"]).toBe(wideSource);
    expect(deps[wideSource]).toBeUndefined();
    // The client-source memo's reads are the client's: `late` mounts on any named write.
    expect(deps["!"]).toBe("late#0");
    // Own state (the items' click counters and card-local stores) and
    // unnamed sources (the projection store, the derived signal, the store
    // created outside any owner) are not edges.
    expect(named.sort()).toEqual([cart, currency, store].sort());
    writeArtifact("frame-dependency-edges", { name: "frame-dependency-edges", shell, rest });
  });
});
