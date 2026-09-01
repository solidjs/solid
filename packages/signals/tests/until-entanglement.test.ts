/**
 * #3164 follow-up (GabbeV) — until() flip-entanglement, cross-primitive.
 *
 * The fold ruling entangles landings with optimism ON THE SAME FAMILY. But
 * `until()` is itself a declaration of relatedness: the predicate names the
 * condition that confirms the action. When a FOREIGN transition's staged
 * write flips the predicate truthy, that transition is the confirming event
 * by the user's own definition — it must reveal WITH the awaiting action's
 * settle, not before. Otherwise the confirmation (new data, version bump)
 * paints while the action's optimism still holds:
 *
 *   saving=true,  version=old, data=old
 *   saving=true,  version=new, data=new   <- the tear: no timeline contains it
 *   saving=false, version=new, data=new
 *
 * Entanglement is declaration-scoped: updates that do NOT flip the predicate
 * reveal freely on their own schedule (they were never named as the
 * confirmation), and only the flipping transition merges.
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
  until
} from "../src/index.js";

const settle = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("until() flip-entanglement (#3164 follow-up)", () => {
  it("the transition that flips an awaited until() reveals with the action, not before", async () => {
    let landV1!: () => void;
    const v1 = new Promise<void>(r => (landV1 = r));

    const log: string[] = [];
    let saving!: () => boolean;
    let setSaving!: (v: boolean) => void;
    let stream!: () => { version: number; data: string };
    let save!: () => Promise<unknown>;

    createRoot(() => {
      [saving, setSaving] = createOptimistic(false);
      // Independent live source — no optimism on this primitive, so the
      // family fold never applies. Its landings ride their own transition.
      stream = createMemo(async function* () {
        yield { version: 0, data: "old" };
        await v1;
        yield { version: 1, data: "new" };
      });
      save = action(function* () {
        setSaving(true);
        yield until(() => stream().version >= 1);
      });
      createRenderEffect(
        () => `saving=${saving()} version=${stream().version} data=${stream().data}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    await settle();
    expect(log.at(-1)).toBe("saving=false version=0 data=old");

    const done = save();
    flush();
    await settle();
    // Optimistic frame while awaiting confirmation.
    expect(log.at(-1)).toBe("saving=true version=0 data=old");

    // The confirming landing arrives on the foreign primitive.
    landV1();
    await done;
    await settle();

    // Joint reveal: optimism reverts and the confirmation lands in ONE frame.
    expect(log.at(-1)).toBe("saving=false version=1 data=new");
    // The pinned invariant: the confirmation never paints under live optimism.
    expect(log).not.toContain("saving=true version=1 data=new");
  });

  it("the stolen confirmation stays held while the action awaits further work past the flip", async () => {
    // GabbeV's sharpened form: when `yield until(...)` is the action's LAST
    // statement, the reveal and the revert coincide by timing alone — the
    // entanglement only proves itself when the action stays open PAST the
    // flip. Here a second async (the upload) extends the transaction beyond
    // the confirmation; the stolen cargo must stay masked the whole window.
    let landV1!: () => void;
    const v1 = new Promise<void>(r => (landV1 = r));
    let finishUpload!: () => void;
    const upload = new Promise<void>(r => (finishUpload = r));

    const log: string[] = [];
    let saving!: () => boolean;
    let setSaving!: (v: boolean) => void;
    let stream!: () => { version: number; data: string };
    let save!: () => Promise<unknown>;

    createRoot(() => {
      [saving, setSaving] = createOptimistic(false);
      stream = createMemo(async function* () {
        yield { version: 0, data: "old" };
        await v1;
        yield { version: 1, data: "new" };
      });
      save = action(function* () {
        setSaving(true);
        yield until(() => stream().version >= 1);
        // The action is not done when the confirmation lands: the hold must
        // outlive the flip, not just reach it.
        yield upload;
      });
      createRenderEffect(
        () => `saving=${saving()} version=${stream().version} data=${stream().data}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    await settle();
    expect(log.at(-1)).toBe("saving=false version=0 data=old");

    const done = save();
    flush();
    await settle();
    expect(log.at(-1)).toBe("saving=true version=0 data=old");

    // The confirmation flips the predicate and resolves the until(), but the
    // action is still uploading: the extended window where a timing-masked
    // implementation would leak the confirmation under live optimism.
    landV1();
    await settle();
    await settle();
    expect(log.at(-1)).toBe("saving=true version=0 data=old");

    finishUpload();
    await done;
    await settle();
    expect(log.at(-1)).toBe("saving=false version=1 data=new");
    expect(log).not.toContain("saving=true version=1 data=new");
  });

  it("one confirmation awaited by two actions settles them jointly, in one frame", async () => {
    // The steal chain composes: A's flip steals the carrier's cargo into A;
    // B's flip then finds the cargo stamped to A (a live foreign transition)
    // and steals onward, entangling A with B. Both optimisms must hold until
    // the JOINT settle — no frame may show one action reverted while the
    // shared confirmation (or the other's hold) is still pending.
    let landV1!: () => void;
    const v1 = new Promise<void>(r => (landV1 = r));
    let finishB!: () => void;
    const bTail = new Promise<void>(r => (finishB = r));

    const log: string[] = [];
    let savingA!: () => boolean;
    let setSavingA!: (v: boolean) => void;
    let savingB!: () => boolean;
    let setSavingB!: (v: boolean) => void;
    let stream!: () => { version: number; data: string };
    let saveA!: () => Promise<unknown>;
    let saveB!: () => Promise<unknown>;

    createRoot(() => {
      [savingA, setSavingA] = createOptimistic(false);
      [savingB, setSavingB] = createOptimistic(false);
      stream = createMemo(async function* () {
        yield { version: 0, data: "old" };
        await v1;
        yield { version: 1, data: "new" };
      });
      saveA = action(function* () {
        setSavingA(true);
        yield until(() => stream().version >= 1);
      });
      saveB = action(function* () {
        setSavingB(true);
        yield until(() => stream().version >= 1);
        yield bTail; // B outlives the shared confirmation
      });
      createRenderEffect(
        () => `A=${savingA()} B=${savingB()} v=${stream().version} data=${stream().data}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    await settle();
    expect(log.at(-1)).toBe("A=false B=false v=0 data=old");

    const doneA = saveA();
    const doneB = saveB();
    flush();
    await settle();
    expect(log.at(-1)).toBe("A=true B=true v=0 data=old");

    // The confirmation lands and A's action completes, but B still holds the
    // jointly-stolen cargo: A's optimism stays displayed — a lone revert here
    // would paint A=false against data the hold is still hiding.
    landV1();
    await doneA;
    await settle();
    expect(log.at(-1)).toBe("A=true B=true v=0 data=old");

    finishB();
    await doneB;
    await settle();
    expect(log.at(-1)).toBe("A=false B=false v=1 data=new");
    // The joint-settle invariants: the confirmation never paints under either
    // live optimism, and neither action reverts ahead of the reveal.
    expect(log).not.toContain("A=true B=true v=1 data=new");
    expect(log).not.toContain("A=false B=true v=0 data=old");
    expect(log).not.toContain("A=false B=true v=1 data=new");
  });

  it("non-flipping updates on the watched source reveal freely while the action waits", async () => {
    let landV1!: () => void;
    const v1 = new Promise<void>(r => (landV1 = r));
    let landV2!: () => void;
    const v2 = new Promise<void>(r => (landV2 = r));

    const log: string[] = [];
    let saving!: () => boolean;
    let setSaving!: (v: boolean) => void;
    let stream!: () => { version: number; data: string };
    let save!: () => Promise<unknown>;

    createRoot(() => {
      [saving, setSaving] = createOptimistic(false);
      stream = createMemo(async function* () {
        yield { version: 0, data: "old" };
        await v1;
        yield { version: 1, data: "mid" };
        await v2;
        yield { version: 2, data: "new" };
      });
      save = action(function* () {
        setSaving(true);
        // Waits for version 2 — the version-1 landing is NOT the confirmation.
        yield until(() => stream().version >= 2);
      });
      createRenderEffect(
        () => `saving=${saving()} version=${stream().version} data=${stream().data}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    await settle();

    const done = save();
    flush();
    await settle();
    expect(log.at(-1)).toBe("saving=true version=0 data=old");

    // An in-between landing that does not flip the predicate was never named
    // as the confirmation: it reveals on its own schedule, optimism intact.
    landV1();
    await settle();
    expect(log.at(-1)).toBe("saving=true version=1 data=mid");

    // The flipping landing entangles: joint reveal.
    landV2();
    await done;
    await settle();
    expect(log.at(-1)).toBe("saving=false version=2 data=new");
    expect(log).not.toContain("saving=true version=2 data=new");
  });

  it("store path: a foreign store's confirming landing reveals with the action, not before", async () => {
    let landV1!: () => void;
    const v1 = new Promise<void>(r => (landV1 = r));

    const log: string[] = [];
    let saving!: () => boolean;
    let setSaving!: (v: boolean) => void;
    let stream!: { version: number; data: string };
    let save!: () => Promise<unknown>;

    createRoot(() => {
      [saving, setSaving] = createOptimistic(false);
      // Foreign STORE primitive: fed by its own async source, carrying no
      // optimism of its own — its landings are ordinary store landings.
      [stream] = createOptimisticStore<{ version: number; data: string }>(
        async function* () {
          yield { version: 0, data: "old" };
          await v1;
          yield { version: 1, data: "new" };
        },
        { version: 0, data: "old" }
      );
      save = action(function* () {
        setSaving(true);
        yield until(() => stream.version >= 1);
      });
      createRenderEffect(
        () => `saving=${saving()} version=${stream.version} data=${stream.data}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    await settle();
    expect(log.at(-1)).toBe("saving=false version=0 data=old");

    const done = save();
    flush();
    await settle();
    expect(log.at(-1)).toBe("saving=true version=0 data=old");

    landV1();
    await done;
    await settle();

    expect(log.at(-1)).toBe("saving=false version=1 data=new");
    expect(log).not.toContain("saving=true version=1 data=new");
  });

  it("a predicate already truthy against committed state resolves without holding anything", async () => {
    const log: string[] = [];
    let saving!: () => boolean;
    let setSaving!: (v: boolean) => void;
    let version!: () => number;
    let setVersion!: (v: number) => void;
    let save!: () => Promise<unknown>;

    createRoot(() => {
      [saving, setSaving] = createOptimistic(false);
      [version, setVersion] = createSignal(1);
      save = action(function* () {
        setSaving(true);
        yield until(() => version() >= 1);
      });
      createRenderEffect(
        () => `saving=${saving()} version=${version()}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    await settle();

    const done = save();
    flush();
    await done;
    await settle();
    expect(log.at(-1)).toBe("saving=false version=1");
    // Public state was already consistent — nothing to entangle, no hold.
    setVersion(2);
    flush();
    expect(log.at(-1)).toBe("saving=false version=2");
  });
});
