import { createRoot, createSignal, createEffect, SuspenseContext, lazy, loadResource } from '../dist/index';

describe('Simulate Lazy Component', () => {
  let resolve, result;
  const LazyChild = lazy(() => new Promise(r => resolve = r)),
    Child = props => props.greeting;

  test('setup context', async done => {
    createRoot(() => {
      const props = {}
      Object.defineProperty(props, 'children', {
        get() {
          const value = LazyChild({greeting: 'Hello'})
          createEffect(() => result = value());
        }
      })
      SuspenseContext.Provide(props);
    });
    expect(result).toBeUndefined();
    await resolve({default: Child});
    await Promise.resolve();
    expect(result).toBe('Hello');
    done();
  });
});

describe('Simulate a dynamic fetch', () => {
  let resolve, trigger, result;
  function fetcher(id) {
    return new Promise(r => resolve = r)
  }

  test('initial async resource', async done => {
    createRoot(() => {
      const [id, setId] = createSignal(1);
      trigger = setId;
      result = loadResource(() => fetcher(id()))
    });
    expect(result.data).toBeUndefined();
    expect(result.loading).toBe(true);
    resolve('John');
    await Promise.resolve();
    expect(result.data).toBe('John');
    expect(result.loading).toBe(false);
    done();
  });

  test('test out of order', async done => {
    trigger(2);
    expect(result.loading).toBe(true);
    const resolve1 = resolve;
    trigger(3);
    const resolve2 = resolve;
    resolve2('Jake');
    resolve1('Jo');
    await Promise.resolve();
    expect(result.data).toBe('Jake');
    expect(result.loading).toBe(false);
    done();
  });
})