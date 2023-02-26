import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flushSync,
  getOwner,
} from "../src";

function gc() {
  return new Promise((resolve) =>
    setTimeout(async () => {
      flushSync(); // flush call stack (holds a reference)
      global.gc!();
      resolve(void 0);
    }, 0)
  );
}

if (global.gc) {
  it("should gc computed if there are no observers", async () => {
    const [$x] = createSignal(0),
      ref = new WeakRef(createMemo(() => $x()));

    await gc();
    expect(ref.deref()).toBeUndefined();
  });

  it("should _not_ gc computed if there are observers", async () => {
    let [$x] = createSignal(0),
      pointer;

    const ref = new WeakRef((pointer = createMemo(() => $x())));

    ref.deref()!();

    await gc();
    expect(ref.deref()).toBeDefined();

    pointer = undefined;
    await gc();
    expect(ref.deref()).toBeUndefined();
  });

  it("should gc root if disposed", async () => {
    let [$x] = createSignal(0),
      ref!: WeakRef<any>,
      pointer;

    const dispose = createRoot((dispose) => {
      ref = new WeakRef(
        (pointer = createMemo(() => {
          $x();
        }))
      );

      return dispose;
    });

    await gc();
    expect(ref.deref()).toBeDefined();

    dispose();
    await gc();
    expect(ref.deref()).toBeDefined();

    pointer = undefined;
    await gc();
    expect(ref.deref()).toBeUndefined();
  });

  it("should gc effect lazily", async () => {
    let [$x, setX] = createSignal(0),
      ref!: WeakRef<any>;

    const dispose = createRoot((dispose) => {
      createEffect(() => {
        $x();
        ref = new WeakRef(getOwner()!);
      });

      return dispose;
    });

    await gc();
    expect(ref.deref()).toBeDefined();

    dispose();
    setX(1);

    await gc();
    expect(ref.deref()).toBeUndefined();
  });
} else {
  it("", () => {});
}
