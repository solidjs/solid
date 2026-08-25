/**
 * Reveal-gating contract pins (architecture audit, spike 4).
 *
 * `stashedOptimisticReads` was deleted: it forced a committed-view effect
 * re-run when a transaction backgrounded, which masked an active override
 * from stale tracked reads (against A17) and un-rendered co-written optimistic
 * flags mid-window (against the A24 §1 affordance idiom). It engaged zero
 * times across the whole suite, so its observable contract was never pinned —
 * these tests pin the post-deletion behavior so it cannot silently return.
 *
 * The queue stash and `_gatedSubs` replay are NOT deleted (they cover
 * transaction-held reveal and silent-revert re-ask respectively); S4 pins the
 * queue stash, which the suite also never interleaved.
 */
import {
  action,
  createEffect,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh
} from "../src/index.js";

describe("reveal gating: backgrounded transaction", () => {
  // S3: an action co-writes a plain optimistic flag while an optimistic async
  // source's own refetch keeps the transaction incomplete. The override wins
  // visually (A17) and the co-written flag stays rendered through the window;
  // the render effect still reports pendingness, and the transaction stays
  // incomplete (its refetch, not the deleted mechanism, gates completion).
  it("keeps a co-written optimistic flag rendered and fires user effects once", async () => {
    const renders: Array<readonly [string, boolean]> = [];
    const savingEffect: boolean[] = [];
    let send!: () => Promise<void>;
    let saving!: () => boolean;

    createRoot(() => {
      const [user, setUser] = createOptimistic<string>(async () => "Settled");
      const [savingRead, setSaving] = createOptimistic(false);
      saving = savingRead;
      const boundary = createLoadingBoundary(user, () => "Loading");
      createRenderEffect(
        () => [boundary(), savingRead()] as const,
        v => {
          renders.push(v);
        }
      );
      createEffect(
        () => savingRead(),
        v => {
          savingEffect.push(v);
        }
      );

      send = action(function* () {
        setSaving(true);
        setUser(() => "Optimistic");
        refresh(user); // own refetch keeps the transaction incomplete
      });
    });

    await Promise.resolve();
    flush();

    void send().catch(() => {});
    flush();

    // Through the backgrounded window the flag stays true (override wins, A17)
    // and never flips back to the committed false mid-window.
    expect(saving()).toBe(true);
    expect(renders.some(([, s]) => s === true)).toBe(true);
    expect(renders).not.toContainEqual(["Optimistic", false]);
    // The user effect fires for the real transitions only (false -> true),
    // never a duplicate committed-view re-run of the same value.
    expect(savingEffect).toEqual([false, true]);
  });
});

describe("reveal gating: queue stash", () => {
  // S4: the queue stash IS load-bearing (its removal tears transactions), but
  // the suite never interleaved an ambient flush with a stashed transaction.
  // A transaction-held effect phase must not run during an interleaved ambient
  // flush — it reveals only at the holding transaction's completion.
  it("a transaction-held effect does not leak during an interleaved ambient flush", async () => {
    const held: number[] = [];
    const ambient: number[] = [];
    let send!: () => Promise<void>;
    let resolveWork!: (v: number) => void;
    let setOther!: (v: number) => number;

    createRoot(() => {
      const [a, setA] = createSignal(0);
      const [other, setOtherFn] = createSignal(0);
      setOther = setOtherFn;
      const [gate, setGate] = createSignal<Promise<number> | number>(0);

      const g = createMemo(() => gate());
      createRenderEffect(
        () => {
          try {
            void g();
          } catch {
            /* pending */
          }
        },
        () => {}
      );
      createEffect(
        () => a(),
        v => {
          held.push(v);
        }
      );
      createEffect(
        () => other(),
        v => {
          ambient.push(v);
        }
      );

      send = action(function* () {
        setA(1); // held by the action's transition
        setGate(new Promise<number>(res => (resolveWork = res))); // keeps it incomplete
        yield;
      });
    });

    flush();
    void send().catch(() => {});
    flush(); // transition incomplete -> stash

    setOther(1); // ambient write while the transition is stashed
    flush(); // ambient flush must not reveal the held effect

    // held effect has NOT re-run for the stashed value yet
    expect(held).toEqual([0]);
    expect(ambient).toEqual([0, 1]);

    resolveWork(42);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    // now the transaction completes and the held effect reveals
    expect(held).toEqual([0, 1]);
  });
});
