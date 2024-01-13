import { createRenderEffect, createSignal } from '../src';

it('should work with baisc renderEffects', () => {
  const [a, setA] = createSignal(0);
  createRenderEffect(
    () => a(),
    (a) => {
      console.log(a);
    },
  );
});
