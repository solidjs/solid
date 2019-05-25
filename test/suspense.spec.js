const { createRoot, createEffect, setContext, SuspenseContext, lazy } = require('../lib/solid');

describe('Simulate Lazy Component', () => {
  let resolve, result;
  const LazyChild = lazy(() => new Promise(r => resolve = r)),
    Child = props => props.greeting;

  test('setup context', async done => {
    createRoot(() => {
      setContext(SuspenseContext.id, SuspenseContext.initFn());
      const value = LazyChild({greeting: 'Hello'})
      createEffect(() => result = value());
    });
    expect(result).toBeUndefined();
    resolve({default: Child});
    await Promise.resolve();
    expect(result).toBe('Hello');
    done();
  });
});