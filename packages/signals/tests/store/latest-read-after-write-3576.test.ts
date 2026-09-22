import { createStore, flush, latest } from "../../src/index.js";

function writeAndReadBack(withLatest: boolean): number[] {
  const [store, setStore] = createStore(() => ({ value: 0 }), { value: 0 });
  flush();
  if (withLatest) latest(() => store.value);
  const reads = [store.value];
  for (let i = 1; i < 5; i++) {
    setStore(v => {
      v.value = i;
    });
    reads.push(store.value);
  }
  flush();
  reads.push(store.value);
  return reads;
}

it("untracked reads of a projection see each setter write whether or not latest() read it first (#3576)", () => {
  expect(writeAndReadBack(false)).toEqual([0, 1, 2, 3, 4, 4]);
  expect(writeAndReadBack(true)).toEqual([0, 1, 2, 3, 4, 4]);
});
