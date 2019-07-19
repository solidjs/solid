import { setDefaults } from '../dist/index';

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
