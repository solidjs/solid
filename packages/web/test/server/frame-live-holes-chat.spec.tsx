/**
 * @jsxImportSource @solidjs/web
 *
 * The chat demo's full shape as a probe: multiple paragraph parts each with
 * its own <Loading> and an async-iterable-fed memo rendering into an
 * innerHTML live hole, plus a status SLOT carrying an async-iterable arg
 * (value tier — rides the data channel) and a promise arg. This is the
 * structure that starved the dev server's event loop (OOM after the stream
 * stalled), so beyond correctness it asserts the response actually
 * completes in bounded time.
 */
import { describe, expect, it } from "vitest";
import { createMemo } from "solid-js";
import { Loading } from "@solidjs/web";
import { asyncArg } from "../../frames/src/server.js";
import { renderServerComponent } from "../../frames/src/frame-sink.js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function channel<T>() {
  const queue: T[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  const wake = () => {
    notify?.();
    notify = null;
  };
  return {
    push(v: T) {
      queue.push(v);
      wake();
    },
    end() {
      done = true;
      wake();
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<T>> {
            while (queue.length === 0) {
              if (done) return { value: undefined as any, done: true };
              await new Promise<void>(r => (notify = r));
            }
            return { value: queue.shift()!, done: false };
          }
        };
      }
    } as AsyncIterable<T>
  };
}

/** The model: paragraphs streamed sequentially, a progress ticker, a stats promise. */
function generate(paragraphs: string[][]) {
  const parts = paragraphs.map(() => channel<string>());
  const progress = channel<string>();
  let resolveStats!: (v: any) => void;
  const stats = new Promise(r => (resolveStats = r));
  (async () => {
    let tokens = 0;
    progress.push("thinking…");
    await sleep(10);
    for (let i = 0; i < paragraphs.length; i++) {
      let acc = "";
      for (const word of paragraphs[i]) {
        await sleep(10);
        acc += (acc ? " " : "") + word;
        tokens++;
        parts[i].push(acc);
        progress.push(`${tokens} tokens…`);
      }
      parts[i].end();
    }
    resolveStats({ tokens });
    progress.end();
  })();
  return { parts: parts.map(p => p.iterable), progress: progress.iterable, stats };
}

function Part(props: { text: AsyncIterable<string> }) {
  const text = createMemo(() => props.text);
  return (
    <Loading fallback={<p class="typing">▍</p>}>
      <div class="md" innerHTML={`<p>${text()}</p>`} />
    </Loading>
  );
}

describe("the chat demo shape (multi-part live holes + value-tier slot args)", () => {
  it("streams every part to completion in bounded time", async () => {
    const gen = generate([
      ["alpha", "beta", "gamma"],
      ["delta", "epsilon"],
      ["zeta", "eta", "theta"]
    ]);
    const ServerComp = (props: any) => (
      <section class="reply">
        {gen.parts.map(part => (
          <Part text={part} />
        ))}
        <props.status progress={asyncArg(gen.progress)} stats={asyncArg(gen.stats)} />
      </section>
    );
    const chunks: any[] = await (renderServerComponent(ServerComp, {
      frame: { id: "f" }
    }) as any);

    // Every paragraph's final markdown shipped — via its fragment splice or
    // a hole re-emission — and the response completed (the iterable holds
    // released at end of generation).
    const all = chunks
      .filter(c => c.type === "html" || c.type === "fragment" || c.type === "hole")
      .map(c => c.html)
      .join("\n");
    expect(all).toContain("alpha beta gamma");
    expect(all).toContain("delta epsilon");
    expect(all).toContain("zeta eta theta");
    expect(chunks[chunks.length - 1].type).toBe("complete");

    // Growth stayed bounded: intermediate yields re-emit over the SAME hole
    // keys (morphs), not as ever-new bindings or fragments.
    const holeKeys = new Set(chunks.filter(c => c.type === "hole").map(c => c.key));
    expect(holeKeys.size).toBeLessThanOrEqual(3);

    // The value-tier progress iterable rode the data channel to completion.
    const datas = chunks.filter(c => c.type === "data");
    expect(JSON.stringify(datas)).toContain("8 tokens");
  }, 15000);
});
