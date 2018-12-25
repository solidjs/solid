const { useSignal, root, pipe, map } = require('../lib/solid');
const Observable = require('zen-observable');

describe('pipe operator', () => {

  test('Signal passthrough', () => {
    root(() => {
      var data = useSignal(5),
          out = pipe(data);

      expect(out).toBe(data);
    });
  });

  test('pipe map', () => {
    root(() => {
      var data = useSignal(5),
          out = pipe(data, map(i => i * 2));

      expect(out()).toBe(data() * 2);
    });
  });
});
