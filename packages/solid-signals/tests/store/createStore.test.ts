import { createEffect, createStore, flushSync } from '../../src';

describe('getters', () => {
  it('supports getters that return frozen objects', () => {
    const [store, setStore] = createStore({
      get foo() {
        return Object.freeze({ foo: 'foo' });
      },
    });

    expect(() => store.foo).not.toThrow();
  });
});

describe('arrays', () => {
  it('supports arrays', () => {
    const [store, setStore] = createStore([{ i: 1 }, { i: 2 }, { i: 3 }]);
    const effectA = vi.fn();
    const effectB = vi.fn();
    const effectC = vi.fn();
    createEffect(() => store.reduce((m, n) => m + n.i, 0), (v) => effectA(v));
    createEffect(() => {
      const row = store[0];
      createEffect(() => row.i, (v) => effectC(v));
      return row;
    }, (v) => effectB(v.i));
    flushSync();
    expect(effectA).toHaveBeenCalledTimes(1);
    expect(effectA).toHaveBeenCalledWith(6);
    expect(effectB).toHaveBeenCalledTimes(1);
    expect(effectB).toHaveBeenCalledWith(1);
    expect(effectC).toHaveBeenCalledTimes(1);
    expect(effectC).toHaveBeenCalledWith(1);

    setStore((s) => {
      s[0].i = 2;
    });
    flushSync();
    expect(effectA).toHaveBeenCalledTimes(2);
    expect(effectA).toHaveBeenCalledWith(7);
    expect(effectB).toHaveBeenCalledTimes(1);
    expect(effectC).toHaveBeenCalledTimes(2);
    expect(effectC).toHaveBeenCalledWith(2);

    setStore((s) => {
      s.push({ i: 4 });
    });
    flushSync();
    expect(effectA).toHaveBeenCalledTimes(3);
    expect(effectA).toHaveBeenCalledWith(11);
    expect(effectB).toHaveBeenCalledTimes(1);
    expect(effectC).toHaveBeenCalledTimes(2);
  })
})