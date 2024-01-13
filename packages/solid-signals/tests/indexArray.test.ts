import { createSignal, indexArray } from '../src';

it('should compute map', () => {
  const [$source, setSource] = createSignal([1, 2, 3]);

  const computed = vi.fn();
  const map = indexArray($source, (value, index) => {
    computed();
    return {
      i: index,
      get id() {
        return value() * 2;
      },
    };
  });

  const [a, b, c] = map();
  expect(a.i).toBe(0);
  expect(a.id).toBe(2);
  expect(b.i).toBe(1);
  expect(b.id).toBe(4);
  expect(c.i).toBe(2);
  expect(c.id).toBe(6);
  expect(computed).toHaveBeenCalledTimes(3);

  // Move values around
  setSource([3, 2, 1]);

  const [a2, b2, c2] = map();
  expect(a2.i).toBe(0);
  expect(a2.id).toBe(6);
  expect(a === a2).toBeTruthy();
  expect(b2.i).toBe(1);
  expect(b2.id).toBe(4);
  expect(b === b2).toBeTruthy();
  expect(c2.i).toBe(2);
  expect(c2.id).toBe(2);
  expect(c === c2).toBeTruthy();
  expect(computed).toHaveBeenCalledTimes(3);

  // Add new value
  setSource([3, 2, 1, 4]);

  expect(map().length).toBe(4);
  expect(map()[map().length - 1].i).toBe(3);
  expect(map()[map().length - 1].id).toBe(8);
  expect(computed).toHaveBeenCalledTimes(4);

  // Remove value
  setSource([2, 1, 4]);

  expect(map().length).toBe(3);
  expect(map()[0].id).toBe(4);

  // Empty
  setSource([]);

  expect(map().length).toBe(0);
  expect(computed).toHaveBeenCalledTimes(4);
});
