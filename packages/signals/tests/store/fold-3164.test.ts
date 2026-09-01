/**
 * #3164 — GabbeV's until-tear, pinned as the fold ruling's regression tests.
 *
 * A discriminated-union session where the truth flight lands a DIFFERENT
 * SHAPE ({status:'authenticated', user} — no account) while the action's
 * transaction is still held open by an unrelated async (vaultKey). Two
 * failure modes ruled out together:
 *
 * - THE TEAR (store path): a speculative recompute composing the retained
 *   override (status='signingIn') with fold-staged truth (account gone,
 *   user present) — a state no timeline contains. Held truth on armed
 *   nodes is masked from ordinary readers until the reveal.
 * - THE DEADLOCK (both paths): until()'s authoritative predicate must
 *   tunnel into the staged truth (and be woken when it stages), or the
 *   landing waits on the transaction, the transaction on the action, and
 *   the action on an until() that never re-runs.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  until
} from "../../src/index.js";

const settle = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Session =
  | { status: "signedOut" | "signingIn"; account: { email: string }; user?: undefined }
  | { status: "authenticated"; user: { name: string }; account?: undefined };

function renderSession(s: Session): string {
  let render: string;
  try {
    render =
      s.status === "signedOut"
        ? `Sign in as ${s.account.email}`
        : s.status === "signingIn"
          ? `Signing in as ${s.account.email}`
          : s.status === "authenticated"
            ? `Signed in as ${s.user.name}`
            : "??";
  } catch (e: any) {
    render = `RUNTIME ERROR: ${e.message}`;
  }
  return `status=${s.status} account=${!!s.account} user=${!!s.user} | ${render}`;
}

describe("#3164: union-shape landing under a held transaction", () => {
  it("store path: no torn frame, until() tunnels, atomic reveal at settle", async () => {
    let resolveAuth!: () => void;
    const authenticated = new Promise<void>(r => (resolveAuth = r));
    let resolveVault!: () => void;
    const vaultPromise = new Promise<void>(r => (resolveVault = r));

    const log: string[] = [];
    let state!: { session: Session };
    let setState!: (fn: (s: { session: Session }) => void) => void;
    let signIn!: () => Promise<unknown>;

    createRoot(() => {
      [state, setState] = createOptimisticStore<{ session: Session }>(
        async function* () {
          yield { session: { status: "signedOut", account: { email: "gabriel@example.com" } } };
          await authenticated;
          yield { session: { status: "authenticated", user: { name: "Gabriel" } } };
        },
        { session: { status: "signedOut", account: { email: "gabriel@example.com" } } }
      );

      const [submittedPassphrase, submitPassphrase] = createSignal<string>();
      const vaultKey = createMemo(() => {
        const p = submittedPassphrase();
        return p ? vaultPromise.then(() => "Unlocked") : "Locked";
      });

      signIn = action(function* () {
        setState(store => {
          store.session.status = "signingIn";
        });
        submitPassphrase("correct horse battery staple");
        yield until(() => state.session.status === "authenticated");
      });

      createRenderEffect(
        () => `${renderSession(state.session)} | vaultPending=${isPending(() => vaultKey())}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    await settle();
    expect(log.at(-1)).toContain("status=signedOut account=true user=false");

    const done = signIn();
    flush();
    await settle();
    // Optimistic frame: the union stays coherent (account intact).
    expect(log.at(-1)).toContain("status=signingIn account=true user=false");

    // Auth lands while vaultKey still pends: the truth folds — no frame may
    // compose the override with the landed shape (the tear).
    resolveAuth();
    await settle();
    await settle();
    expect(log.at(-1)).toContain("status=signingIn account=true user=false");

    // Vault resolves: the transaction settles, the reveal is atomic.
    resolveVault();
    await done;
    await settle();
    await settle();
    expect(log.at(-1)).toContain("status=authenticated account=false user=true");

    // The pinned invariant: every frame is a state some timeline contained.
    for (const frame of log) {
      expect(frame).not.toContain("RUNTIME ERROR");
      expect(frame).not.toContain("account=false user=true | Signing in");
      expect(frame).not.toContain("status=signingIn account=false");
    }
  });

  it("signal path: until() is woken by a landing staged under an active override (no deadlock)", async () => {
    let resolveAuth!: () => void;
    const authenticated = new Promise<void>(r => (resolveAuth = r));
    let resolveVault!: () => void;
    const vaultPromise = new Promise<void>(r => (resolveVault = r));

    const log: string[] = [];
    let session!: () => Session;
    let setSession!: (fn: (s: Session) => Session) => void;
    let signIn!: () => Promise<unknown>;

    createRoot(() => {
      [session, setSession] = createOptimistic<Session>(async function* () {
        yield { status: "signedOut", account: { email: "gabriel@example.com" } };
        await authenticated;
        yield { status: "authenticated", user: { name: "Gabriel" } };
      });

      const [submittedPassphrase, submitPassphrase] = createSignal<string>();
      const vaultKey = createMemo(() => {
        const p = submittedPassphrase();
        return p ? vaultPromise.then(() => "Unlocked") : "Locked";
      });

      signIn = action(function* () {
        setSession(s => ({ ...s, status: "signingIn" }) as Session);
        submitPassphrase("correct horse battery staple");
        yield until(() => session().status === "authenticated");
      });

      createRenderEffect(
        () => `${renderSession(session())} | vaultPending=${isPending(() => vaultKey())}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    await settle();

    const done = signIn();
    flush();
    await settle();
    expect(log.at(-1)).toContain("status=signingIn account=true user=false");

    // Auth lands: until()'s authoritative probe must be re-notified even
    // though the override is active (the asyncWrite wake) — pre-fix this
    // deadlocked and the action never completed.
    resolveAuth();
    await settle();
    await settle();
    // Whole-value writes: the fold masks the landing; ordinary view holds.
    expect(log.at(-1)).toContain("status=signingIn account=true user=false");

    resolveVault();
    await done;
    await settle();
    await settle();
    expect(log.at(-1)).toContain("status=authenticated account=false user=true");
    for (const frame of log) expect(frame).not.toContain("RUNTIME ERROR");
  });
});
