// What the server is spending, for showing that it doesn't grow with the
// audience. Both numbers are the process's, not any viewer's, so the shared
// render may show them.
//
//   viewers  open live responses, counted by the production server
//            (server.js); absent under `pnpm dev`
//   cpu      milliseconds of CPU the process used in the last second;
//            absent until a second has passed

export interface Stats {
  viewers: number | undefined;
  cpu: number | undefined;
}

const VIEWERS = Symbol.for("solid.dbmon.viewers");

function viewers(): number | undefined {
  return (globalThis as any)[VIEWERS];
}

/** The process's numbers now, then again every second, until `signal` aborts. */
export async function* watchStats(signal?: AbortSignal): AsyncGenerator<Stats> {
  let last = process.cpuUsage();
  // No second has passed yet: the count now, and no CPU figure.
  yield { viewers: viewers(), cpu: undefined };
  while (!signal?.aborted) {
    await new Promise<void>(resolve => {
      const timer = setTimeout(done, 1000);
      signal?.addEventListener("abort", done, { once: true });
      function done() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      }
    });
    if (signal?.aborted) return;
    const used = process.cpuUsage(last);
    last = process.cpuUsage();
    yield {
      viewers: viewers(),
      cpu: Math.round((used.user + used.system) / 1000)
    };
  }
}
