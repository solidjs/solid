// Shared harness for the renderToStream failure specs
// (stream-ambient-error-hook-4193, stream-sync-serialize-failure-4227).
// What they look for is a render that never completes, so `settle` races
// the render against a deadline instead of awaiting it, and `watchEscapes`
// owns the process's uncaught channels so a failure that escapes fails the
// test that caused it.
import { renderToStream } from "@solidjs/web";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Own the process's uncaught channels so an escape fails THIS test. */
export async function watchEscapes(run: () => Promise<void>) {
  const events = ["uncaughtException", "unhandledRejection"] as const;
  const previous = events.map(e => process.listeners(e));
  events.forEach(e => process.removeAllListeners(e));
  const escaped: unknown[] = [];
  const capture = (reason: unknown) => escaped.push(reason);
  events.forEach(e => process.on(e, capture));
  try {
    await run();
    for (let turn = 0; turn < 4; turn++) await delay(20);
    return escaped;
  } finally {
    events.forEach((e, i) => {
      process.off(e, capture);
      for (const listener of previous[i]) process.on(e, listener as any);
    });
  }
}

/** Resolves "settled" with the HTML, or "pending" if the render never ends. */
export function settle(p: PromiseLike<string>) {
  return Promise.race([
    Promise.resolve(p).then(html => ({ state: "settled", html })),
    delay(500).then(() => ({ state: "pending", html: "" }))
  ]);
}

export function pipeSettle(code: () => any, options: Parameters<typeof renderToStream>[1] = {}) {
  return settle(
    new Promise<string>(resolve => {
      const chunks: string[] = [];
      renderToStream(code, options).pipe({
        write(chunk: string) {
          chunks.push(String(chunk));
        },
        end() {
          resolve(chunks.join(""));
        }
      });
    })
  );
}
