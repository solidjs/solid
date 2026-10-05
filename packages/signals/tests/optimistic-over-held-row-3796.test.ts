import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../src/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));
async function drain(n = 3) {
  for (let i = 0; i < n; i++) {
    await tick();
    flush();
  }
}

type Card = { id: number; title: string; failed?: boolean; saving?: boolean };

// #3796: an action's write to a row of the derived store an optimistic store
// wraps holds that row's staging; the optimistic write that follows edits the
// row's keys, not the container's slot — the slot is the same row in both
// frames and is no guess. The edit shows while the action is pending (A17).
describe("optimistic store over a row the action holds (#3796)", () => {
  for (const localWrite of [true, false])
    it(`shows the guesses while pending${localWrite ? " after a local write" : ""}`, async () => {
      const shown: string[] = [];
      let save!: () => Promise<void>;
      let complete!: () => void;
      createRoot(() => {
        const [server, setServer] = createSignal<Card[]>([{ id: 1, title: "Old" }]);
        const [local, setLocal] = createStore<Card[]>(draft => {
          const s = server();
          draft.length = 0;
          for (const r of s) draft.push({ ...r, failed: false });
        }, []);
        const [cards, setOptimistic] = createOptimisticStore(local);
        createRenderEffect(
          () => `${cards[0]?.title} / saving: ${!!cards[0]?.saving}`,
          v => {
            shown.push(v);
          }
        );
        save = action(function* () {
          if (localWrite)
            setLocal(draft => {
              draft[0].failed = false;
            });
          setOptimistic(draft => {
            draft[0].title = "New";
            draft[0].saving = true;
          });
          yield new Promise<void>(r => (complete = r));
          setServer([{ id: 1, title: "New" }]);
        });
      });
      flush();
      expect(shown).toEqual(["Old / saving: false"]);
      const p = save();
      await drain();
      expect(shown).toEqual(["Old / saving: false", "New / saving: true"]);
      complete();
      await p;
      await drain();
      expect(shown.at(-1)).toBe("New / saving: false");
    });
});
