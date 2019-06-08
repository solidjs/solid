const { setDefaults, afterEffects } = require('../lib/solid');

describe('Set Default Props', () => {
  test('simple set', () => {
    const props = {a: 'ji', b: null, c: 'j'},
      defaultProps = {a: 'yy', b: 'ggg', d: 'DD'};
    setDefaults(props, defaultProps);
    expect(props.a).toBe('ji');
    expect(props.b).toBe(null);
    expect(props.c).toBe('j');
    expect(props.d).toBe('DD');
  });
});

describe('Trigger afterEffects', () => {
  test('Queue up and execute reverse order', async (done) => {
    let result = ''
    afterEffects(() => result += 'Smith!');
    afterEffects(() => result += 'John ');
    afterEffects(() => result += 'Hello, ');
    expect(result).toBe('');
    await Promise.resolve();
    expect(result).toBe('Hello, John Smith!');
    done();
  });
});
