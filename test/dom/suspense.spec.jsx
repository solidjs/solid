import { lazy, createSignal, createEffect, loadResource } from '../../dist';
import { render } from '../../dist/dom';

describe('Testing a context suspend control flow', () => {
  let div = document.createElement('div'),
    disposer, resolvers = [],
    [triggered, trigger] = createSignal(false);
  const LazyComponent = lazy(() => new Promise(r => resolvers.push(r))),
    ChildComponent = (props) => {
      createEffect(() => triggered() && loadResource(new Promise(r => setTimeout(r, 300))));
      return props.greeting;
    },
    Component = () =>
      <Suspense fallback={'Loading'} delayMs={100}>
        <LazyComponent greeting={'Hi, '}/>
        <LazyComponent greeting={'Jo'}/>
      </Suspense>

  test('Create suspend control flow', () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe('Loading');
  });

  test('Toggle suspend control flow', (done) => {
    for (const r of resolvers) r({ default: ChildComponent });
    setTimeout(() => {
      expect(div.innerHTML).toBe('Hi, Jo');
      done();
    })
  });

  test('Toggle with delayed fallback', (done) => {
    trigger(true);
    expect(div.innerHTML).toBe('Hi, Jo');
    setTimeout(() => {
      expect(div.innerHTML).toBe('Hi, Jo');
    });
    setTimeout(() => {
      expect(div.innerHTML).toBe('Loading');
    }, 200);
    setTimeout(() => {
      expect(div.innerHTML).toBe('Hi, Jo');
      done();
    }, 400);
  })

  test('dispose', () => disposer());
});