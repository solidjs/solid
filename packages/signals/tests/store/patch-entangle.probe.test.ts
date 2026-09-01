import { describe, expect, it } from "vitest";
import {
  action,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  registerPatch,
  until
} from "../../src/index.js";

const settle = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("probe: patch channel vs until() flip-entanglement", () => {
  // PINNED OPEN (rc.6 consolidation target, 2026-09-01): the delivery reads
  // its view outside the masked read seam, so the flip-entanglement steal
  // (which holds the world via node masks, not boundary queues) is invisible
  // to it — a patch consumer observes the confirmed world mid-hold. Held
  // #3091 out of rc.5 over this. Fix shape: deliveries read through the
  // SAME hold resolution the store's traps use + snapshot compare; the
  // structural stash mirrors the steal like mergeTransitionState already
  // mirrors merges. Audit provenance: external probe, reproduced verbatim.
  it("a patch on the confirming foreign store does not apply before the joint settle", async () => {
    let landV1!: () => void;
    const v1 = new Promise<void>(r => (landV1 = r));
    let finishUpload!: () => void;
    const upload = new Promise<void>(r => (finishUpload = r));

    const patches: string[] = [];
    const frames: string[] = [];
    let saving!: () => boolean;
    let setSaving!: (v: boolean) => void;
    let stream!: { doc: { version: number; data: string } };
    let save!: () => Promise<unknown>;

    createRoot(() => {
      [saving, setSaving] = createOptimistic(false);
      [stream] = createOptimisticStore<{ doc: { version: number; data: string } }>(
        async function* () {
          yield { doc: { version: 0, data: "old" } };
          await v1;
          yield { doc: { version: 1, data: "new" } };
        },
        { doc: { version: 0, data: "old" } }
      );
      save = action(function* () {
        setSaving(true);
        yield until(() => stream.doc.version >= 1);
        yield upload; // hold past the flip
      });
      createRenderEffect(
        () => `saving=${saving()} v=${stream.doc.version} data=${stream.doc.data}`,
        v => {
          frames.push(v);
        }
      );
    });
    flush();
    await settle();
    registerPatch(stream.doc, (next: any) => {
      patches.push(`v${next.version}:${next.data}:saving=${saving()}`);
    });

    const done = save();
    flush();
    await settle();
    expect(frames.at(-1)).toBe("saving=true v=0 data=old");
    const patchesBeforeConfirm = patches.length;

    // Confirming landing flips the predicate; the action keeps uploading.
    landV1();
    await settle();
    await settle();
    // Value channel holds (proven elsewhere); the patch channel must too.
    expect(frames.at(-1)).toBe("saving=true v=0 data=old");
    expect(patches.slice(patchesBeforeConfirm)).toEqual([]);

    finishUpload();
    await done;
    await settle();
    expect(frames.at(-1)).toBe("saving=false v=1 data=new");
    // The confirmation's patch applies at (or after) the joint settle, and
    // never under live optimism.
    expect(patches.some(p => p.startsWith("v1:new"))).toBe(true);
    expect(patches).not.toContain("v1:new:saving=true");
  });

  it("STRUCTURAL ops on the confirming foreign store ride the steal, never the carrier's own commit", async () => {
    const { registerRowOps } = await import("../../src/index.js");
    let landV1!: () => void;
    const v1 = new Promise<void>(r => (landV1 = r));
    let finishUpload!: () => void;
    const upload = new Promise<void>(r => (finishUpload = r));

    const rowEvents: Array<{ len: number; saving: boolean }> = [];
    const frames: string[] = [];
    let saving!: () => boolean;
    let setSaving!: (v: boolean) => void;
    let stream!: { rows: { id: number }[] };
    let save!: () => Promise<unknown>;

    createRoot(() => {
      [saving, setSaving] = createOptimistic(false);
      [stream] = (createOptimisticStore as any)(
        async function* () {
          yield { rows: [{ id: 1 }, { id: 2 }] };
          await v1;
          yield { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
        },
        { rows: [{ id: 1 }, { id: 2 }] }
      );
      save = action(function* () {
        setSaving(true);
        yield until(() => stream.rows.length >= 3);
        yield upload; // hold past the flip
      });
      createRenderEffect(
        () => `saving=${saving()} n=${stream.rows.length}`,
        (v: string) => {
          frames.push(v);
        }
      );
    });
    flush();
    await settle();
    createRoot(() => {
      registerRowOps(stream.rows, (rows: any[]) => {
        rowEvents.push({ len: rows.length, saving: saving() });
      });
    });

    const done = save();
    flush();
    await settle();
    expect(frames.at(-1)).toBe("saving=true n=2");
    const mark = rowEvents.length;

    // The confirming landing adds a row — a STRUCTURAL change. Its ops
    // stash on the landing transaction; the steal must carry that stash to
    // the awaiting transaction (the carrier's own commit releasing them
    // would rebuild the list mid-hold, rows=3 beside classic's n=2).
    landV1();
    await settle();
    await settle();
    expect(frames.at(-1)).toBe("saving=true n=2");
    expect(rowEvents.slice(mark)).toEqual([]);

    finishUpload();
    await done;
    await settle();
    expect(frames.at(-1)).toBe("saving=false n=3");
    const after = rowEvents.slice(mark);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every(e => e.saving === false)).toBe(true);
    expect(after.at(-1)!.len).toBe(3);
  });
});
