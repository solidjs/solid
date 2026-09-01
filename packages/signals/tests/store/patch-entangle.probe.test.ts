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
  it.fails(
    "a patch on the confirming foreign store does not apply before the joint settle",
    async () => {
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
    }
  );
});
