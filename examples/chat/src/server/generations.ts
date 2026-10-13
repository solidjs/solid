import "server-only";
// Generation as a job. Sending a message starts one and returns; the job is
// owned by this module, not by any request, so it runs to its end whether or
// not anyone is watching. It writes the reply into the thread as it arrives,
// and what it wrote is all that anyone ever reads.
import * as db from "./db";
import * as model from "./model";

const running = new Map<string, AbortController>();

/** Writes at most this often: a model can outrun a markdown render per token. */
const WRITE_EVERY = 50;

/** Starts writing the reply `replyId` in `threadId`. Returns at once. */
export function start(threadId: string, replyId: string): void {
  const abort = new AbortController();
  running.set(replyId, abort);
  void (async () => {
    const started = Date.now();
    let tokens = 0;
    const pending = { text: "", reasoning: "" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = () => {
      timer = undefined;
      for (const kind of ["reasoning", "text"] as const) {
        if (pending[kind]) db.append(replyId, kind, pending[kind]);
        pending[kind] = "";
      }
    };
    try {
      const history = await db.historyOf(threadId);
      for await (const { type, delta } of model.stream(history, abort.signal)) {
        pending[type] += delta;
        if (type === "text") tokens++;
        timer ??= setTimeout(write, WRITE_EVERY);
      }
      clearTimeout(timer);
      write();
      db.finish(replyId, "complete", {
        usage: { tokens, seconds: Math.round((Date.now() - started) / 100) / 10 }
      });
    } catch (err) {
      clearTimeout(timer);
      write(); // what had arrived is kept either way
      if (abort.signal.aborted) db.finish(replyId, "stopped");
      else {
        console.error(err);
        db.finish(replyId, "failed", {
          error: err instanceof Error ? err.message : "The model stopped answering"
        });
      }
    } finally {
      running.delete(replyId);
    }
  })();
}

/** Stops the reply being written, keeping what has arrived. */
export function stop(replyId: string): void {
  running.get(replyId)?.abort(new Error("Stopped"));
}

/** Whether a job is writing this reply right now. */
export const isRunning = (replyId: string) => running.has(replyId);
