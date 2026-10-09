import {
  createSignal,
  createMemo,
  createRenderEffect,
  createRoot,
  flush,
  resolve,
  until,
  refresh,
  type SourceAccessor
} from "../src/index.js";
function deferred<T>() {
  let ok!: (v: T) => void, bad!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    ok = r;
    bad = j;
  });
  return { promise, ok, bad };
}
const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};
const cases = ["resolve", "until", "refresh"].flatMap(kind =>
  ["value", "error"].map(outcome => ({ kind, outcome }))
);
it.each(cases)("$kind delivers held $outcome with foreign frame", async ({ kind, outcome }) => {
  let request = deferred<number>(),
    sibling = deferred<number>();
  let source!: SourceAccessor<number>;
  const [count, setCount] = createSignal(1);
  const dispose = createRoot(d => {
    source = createMemo(() => {
      count();
      return request.promise;
    });
    const slow = createMemo(() => {
      count();
      return sibling.promise;
    });
    createRenderEffect(slow, () => {}, { schedule: true });
    return d;
  });
  flush();
  request.ok(1);
  sibling.ok(1);
  await tick();
  request = deferred<number>();
  sibling = deferred<number>();
  setCount(2);
  flush();
  const seen: unknown[] = [];
  const delivery =
    kind === "refresh" ? refresh(source) : kind === "until" ? until(source) : resolve(source);
  const watched = delivery.then(
    v => seen.push(v),
    e => seen.push(e)
  );
  await tick();
  const marker = new Error("failed");
  outcome === "error" ? request.bad(marker) : request.ok(2);
  await tick();
  expect(seen).toEqual([]);
  sibling.ok(2);
  await tick();
  await watched;
  expect(seen).toEqual([outcome === "error" ? marker : 2]);
  dispose();
  flush();
});
