/**
 * #4777: a memo whose earlier passes never probed reads `id()`, then
 * `latest(id)` (or `isPending(id)`), then `id()` again, while an action holds
 * `id = 1`. Its first read joined the hold and was served the staging; the
 * probe made the pass a verdict reader and the second read was served the
 * screen: `before=1, latest=1, after=0`, and an async body started its
 * request with those arguments.
 *
 * The two channels of one node agree within a pass in either order (D-25,
 * A10, S-27): a plain read of a node the pass also reads ahead is the
 * screen's. The pass starts over as the verdict reader it is, so both plain
 * reads are the screen's `0`. A memo whose last answer was a flight is an
 * asker and reads the hold's staging plainly instead (S-51): not restarted.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("#4777", () => {
  for (const probe of ["latest", "isPending"] as const)
    for (const mode of ["async", "sync"] as const)
      it(`two plain reads of one signal agree around ${probe}() (${mode} body)`, async () => {
        const requests: string[] = [];
        let shown = "";
        let run!: () => any;
        let enable!: (v: boolean) => void;
        createRoot(() => {
          const [id, setId] = createSignal(0);
          const [enabled, setEnabled] = createSignal(false);
          enable = setEnabled;
          const data = createMemo(() => {
            if (!enabled()) return "Not requested";
            const before = id();
            const ahead = probe === "latest" ? latest(id) : isPending(id);
            const after = id();
            const request = `before=${before}, ${probe}=${ahead}, after=${after}`;
            requests.push(request);
            return mode === "async" ? new Promise<string>(() => {}) : request;
          });
          createRenderEffect(data, v => void (shown = v));
          run = action(function* () {
            setId(1);
            yield new Promise(() => {});
          });
        });
        flush();
        run();
        await tick();
        enable(true);
        flush();
        await tick();
        const expected = `before=0, ${probe}=${probe === "latest" ? 1 : true}, after=0`;
        expect(requests).toEqual([expected]);
        expect(shown).toBe(mode === "sync" ? expected : "Not requested");
      });
});
