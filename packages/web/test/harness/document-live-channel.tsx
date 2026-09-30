/**
 * @jsxImportSource @solidjs/web
 *
 * The chat welcome's markup shape, shared by the document live-channel
 * parity pair (test/server/document-live-channel-artifact.spec.tsx writes
 * the artifact, test/hydration/document-live-channel.spec.tsx replays it):
 * a server component rendered inline at t=0 whose content hole is fed by an
 * async generator. The first yield is the page's markup; every later yield
 * rides the document's `sc:live` channel as a `hole` op the adopted
 * boundary morphs into its range — the card "streams in as the page loads".
 */
import { createMemo, Loading } from "solid-js";

export const FID = "parity/document-live-channel";

export const YIELDS = ["w1", "w1 w2", "w1 w2 w3"];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Server-side only: the generation completes, so the document closes. */
export function makeStreamingComponent() {
  return () => {
    const text = createMemo(async function* () {
      for (let i = 0; i < YIELDS.length; i++) {
        if (i) await sleep(5);
        yield YIELDS[i];
      }
    });
    return (
      <section class="reply">
        <Loading fallback={<span>FB</span>}>
          <div class="md">{text()}</div>
        </Loading>
      </section>
    );
  };
}
