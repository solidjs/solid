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
