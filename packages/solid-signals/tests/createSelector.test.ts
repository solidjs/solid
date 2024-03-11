import {
  createMemo,
  createRoot,
  createSelector,
  createSignal,
  flushSync,
} from '../src';

it('should observe key changes', () => {
  createRoot((dispose) => {
    const [$source, setSource] = createSignal(0),
      isSelected = createSelector($source),
      effect0 = vi.fn(() => isSelected(0)),
      effect1 = vi.fn(() => isSelected(1)),
      effect2 = vi.fn(() => isSelected(2));

    let $effect0 = createMemo(effect0),
      $effect1 = createMemo(effect1),
      $effect2 = createMemo(effect2);

    expect($effect0()).toBe(true);
    expect($effect1()).toBe(false);
    expect($effect2()).toBe(false);

    expect(effect0).toHaveBeenCalledTimes(1);
    expect(effect1).toHaveBeenCalledTimes(1);
    expect(effect2).toHaveBeenCalledTimes(1);

    setSource(1);
    flushSync();

    expect($effect0()).toBe(false);
    expect($effect1()).toBe(true);
    expect($effect2()).toBe(false);

    expect(effect0).toHaveBeenCalledTimes(2);
    expect(effect1).toHaveBeenCalledTimes(2);
    expect(effect2).toHaveBeenCalledTimes(1);

    setSource(2);
    flushSync();

    expect($effect0()).toBe(false);
    expect($effect1()).toBe(false);
    expect($effect2()).toBe(true);

    expect(effect0).toHaveBeenCalledTimes(2);
    expect(effect1).toHaveBeenCalledTimes(3);
    expect(effect2).toHaveBeenCalledTimes(2);

    setSource(-1);
    flushSync();

    expect($effect0()).toBe(false);
    expect($effect1()).toBe(false);
    expect($effect2()).toBe(false);

    expect(effect0).toHaveBeenCalledTimes(2);
    expect(effect1).toHaveBeenCalledTimes(3);
    expect(effect2).toHaveBeenCalledTimes(3);

    dispose();

    setSource(0);
    flushSync();
    setSource(1);
    flushSync();
    setSource(2);
    flushSync();

    expect($effect0).toThrow();
    expect($effect1).toThrow();
    expect($effect2).toThrow();

    expect(effect0).toHaveBeenCalledTimes(2);
    expect(effect1).toHaveBeenCalledTimes(3);
    expect(effect2).toHaveBeenCalledTimes(3);
  });
});
