import { Loading } from "solid-js";
import type { Stats } from "~/lib/model";

/**
 * The client half of the DR-2 showcase. Both props crossed the slot border
 * as async values; both reads here are settled:
 *
 * - `props.stats` was a promise — the read suspends into the outer
 *   `<Loading>` until generation completes, so the ticker shows while the
 *   model "generates" and the numbers replace it when it stops.
 * - `props.progress` was an async iterable — the read is its latest yield,
 *   updating in place as the server pushes. Its own `<Loading>` covers the
 *   instant before the first yield lands.
 */
export default function Status(props: { progress: string; stats: Stats }) {
  return (
    <div class="status">
      <Loading
        fallback={
          <Loading fallback={<span class="ticker">…</span>}>
            <span class="ticker">{props.progress}</span>
          </Loading>
        }
      >
        <span class="done">
          {props.stats.tokens} tokens · {props.stats.rate} tok/s · {props.stats.seconds}s
        </span>
      </Loading>
    </div>
  );
}
