/**
 * @jsxImportSource @solidjs/web
 *
 * Shared source for the document-face slot-fill hydration parity pair
 * (the chat example's `welcome`/`Status` shape).
 *
 * This file is imported by BOTH vitest projects:
 *   - test/server/welcome-status-parity.spec.tsx (ssr generate) — renders the
 *     server component inline at t=0 with the frame sink and writes the chunk
 *     artifact to test/harness/__artifacts__/.
 *   - test/hydration/welcome-status-parity.spec.tsx (dom generate) — replays
 *     the artifact into jsdom and hydrates the identically-sourced fill,
 *     asserting the adopted occurrence claims the server-rendered nodes.
 *
 * The shape under test is DR-2 across the slot border on the DOCUMENT face:
 *   - `progress` — an async iterable read through a memo (case 1 / value
 *     tier at the border),
 *   - `stats`    — a promise read through a memo (settles before the
 *     document closes, so the page ships the settled branch),
 *   - `usage`    — a PROJECTION passed whole (case 3 / container tier),
 *     folding a bounded event stream.
 * The fill reads all three under nested <Loading> boundaries, exactly like
 * the chat example's Status ticker.
 */
import { createMemo, createProjection, Loading } from "solid-js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * One FID per replay mode: the hydration spec runs the artifact twice (page
 * loaded vs mid-stream), and solid's document fragment ledger is module
 * state keyed by hydration id — replaying identical ids in one jsdom
 * process would leak claim/reveal state between the tests.
 */
export const FID = (mode: "loaded" | "streamed") => `parity/welcome-${mode}`;

export interface GenUsage {
  state: string;
  tokens: number;
  parts: number;
}

/** The bounded "generation" — every source completes, so the document
 * response closes on its own (the greet() lifetime). Server-side only. */
export function makeWelcome() {
  async function* progressGen() {
    yield "writing";
    await sleep(5);
    yield "streaming";
  }
  async function* usageEvents(): AsyncGenerator<Partial<GenUsage>> {
    yield { tokens: 5, parts: 1 };
    await sleep(5);
    yield { state: "done", tokens: 9, parts: 2 };
  }
  const gen = {
    progress: progressGen(),
    stats: sleep(15).then(() => ({ tokens: 42, rate: 7 })),
    usage: usageEvents()
  };
  return (props: { status: any }) => {
    const progress = createMemo(() => gen.progress);
    const stats = createMemo(() => gen.stats);
    const usage = createProjection(
      async function* (draft: GenUsage) {
        for await (const event of gen.usage) {
          Object.assign(draft, event);
          yield;
        }
      },
      { state: "thinking", tokens: 0, parts: 0 } as GenUsage
    );
    return (
      <section class="reply">
        <props.status progress={progress()} stats={stats()} usage={usage} />
      </section>
    );
  };
}

/** The client fill — the chat Status component's exact boundary nesting. */
export function StatusFill(props: {
  progress: string;
  stats: { tokens: number; rate: number };
  usage: GenUsage;
}) {
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
          {props.stats.tokens} tokens · {props.stats.rate} tok/s
        </span>
      </Loading>
    </div>
  );
}

/** The authored fill function, shared verbatim by both faces. */
export const statusFill = (p: any) => (
  <StatusFill progress={p.progress} stats={p.stats} usage={p.usage} />
);
