import { Loading } from "solid-js";
import type { Stats } from "~/lib/model";

/**
 * The client half of the DR-2 showcase. Both props crossed the slot border
 * as reactive expressions (case 1) — the server re-evaluates them on every
 * commit and re-ships this occurrence's record, so these are ordinary live
 * props:
 *
 * - `props.stats` is not-ready until generation completes — the read
 *   suspends into the outer `<Loading>`, so the ticker shows while the
 *   model "generates" and the numbers replace it when it stops.
 * - `props.progress` updates in place as the server pushes new yields. Its
 *   own `<Loading>` covers the instant before the first yield lands.
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
