import { Loading } from "solid-js";
import type { Stats, Usage } from "~/lib/model";

/**
 * The client half of the DR-2 showcase — three tiers, one border:
 *
 * - `props.progress` and `props.stats` crossed as reactive expressions
 *   (case 1) — the server re-evaluates them on every commit and re-ships
 *   this occurrence's record. `stats` is not-ready until generation
 *   completes, so its read suspends into the outer `<Loading>`; the ticker
 *   shows meanwhile and the numbers replace it when the model stops.
 * - `props.usage` crossed as a CONTAINER (case 3): the server passed a
 *   projection itself, and this is its live read-only twin. Reads like
 *   local store state — `usage.parts` moves when the stream opens a new
 *   paragraph, `usage.tokens` on every tick, each granularly (a `parts`
 *   write never re-runs a `tokens` read). No totals: like a real
 *   generation, structure is discovered as it streams. Its own `<Loading>`
 *   covers the instant before the trace's snapshot lands.
 */
export default function Status(props: { progress: string; stats: Stats; usage: Usage }) {
  return (
    <div class="status">
      <Loading fallback={<span class="meter">…</span>}>
        <span class="meter">¶ {props.usage.parts}</span>
      </Loading>
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
