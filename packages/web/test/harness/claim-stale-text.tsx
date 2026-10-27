/**
 * @jsxImportSource @solidjs/web
 *
 * A shell source written on the client while a streamed `<Loading>` that
 * reads it is still pending. The source is one of: a shell signal read
 * directly, a sync shell memo, an async shell memo also read in
 * the shell, or one read only inside the boundary; the boundary is held
 * open on the server by its own slow gate. Compiled with both generates:
 * the server spec (test/server/claim-stale-text.gen.spec.tsx) writes the
 * chunks the client spec (test/hydration/claim-stale-text.spec.tsx)
 * replays.
 */
import { createMemo, createSignal, Loading } from "solid-js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function createSharedApp() {
  const [key, setKey] = createSignal("k", { ownedWrite: true });

  function App() {
    const sync = createMemo(() => "sync:" + key());
    const async = createMemo(async () => {
      const k = key();
      await sleep(1);
      return "async:" + k;
    });
    const only = createMemo(async () => {
      const k = key();
      await sleep(1);
      return "only:" + k;
    });
    const gate = createMemo(async () => {
      await sleep(60);
      return "gate";
    });
    return (
      <main>
        <h1>{async()}</h1>
        <Loading fallback={<p>loading</p>}>
          <span class="gate">{gate()}</span>
          <span class="raw">{"raw:" + key()}</span>
          <span class="sync">{sync()}</span>
          <span class="async">{async()}</span>
          <span class="only">{only()}</span>
        </Loading>
      </main>
    );
  }

  return { App, write: (k: string) => setKey(k) };
}

/**
 * The boundary is held open by the async shell memos it reads, still
 * pending on the server when the shell flushed: their answers stream in the
 * boundary's own chunk. `slow` reads the key; `chained` reads `slow`.
 */
export function createPendingApp() {
  const [key, setKey] = createSignal("k", { ownedWrite: true });

  function App() {
    const slow = createMemo(async () => {
      const k = key();
      await sleep(20);
      return "slow:" + k;
    });
    const chained = createMemo(async () => {
      const s = slow();
      await sleep(5);
      return "chained:" + s;
    });
    return (
      <main>
        <h1>{"head:" + key()}</h1>
        <Loading fallback={<p>loading</p>}>
          <span class="slow">{slow()}</span>
          <span class="chained">{chained()}</span>
        </Loading>
      </main>
    );
  }

  return { App, write: (k: string) => setKey(k) };
}
