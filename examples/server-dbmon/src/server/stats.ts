// What the server is spending, for showing that it doesn't grow with the
// audience. Both numbers are the process's, not any viewer's, so the shared
// render may show them.
//
//   viewers  open live responses, counted by the production server
//            (server.js); absent under `pnpm dev`
//   cpu      milliseconds of CPU the process used in the last second

export interface Stats {
  viewers: number | undefined;
  cpu: number;
}

const VIEWERS = Symbol.for("solid.dbmon.viewers");

/** The process's numbers now, then again every second, until `signal` aborts. */
export async function* watchStats(signal?: AbortSignal): AsyncGenerator<Stats> {
  let last = process.cpuUsage();
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
      viewers: (globalThis as any)[VIEWERS] as number | undefined,
      cpu: Math.round((used.user + used.system) / 1000)
    };
  }
}
