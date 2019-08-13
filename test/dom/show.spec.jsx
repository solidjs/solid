import { createRoot, createSignal } from '../../dist/index';

describe('Testing an only child when control flow', () => {
  let div, disposer;
  const [count, setCount] = createSignal(0);
  const Component = () =>
    <div ref={div}><Show when={( count() >= 5 )}>{( count() )}</Show></div>

  test('Create when control flow', () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />
    });

    expect(div.innerHTML).toBe('');
  });

  test('Toggle when control flow', () => {
    setCount(7);
    expect(div.innerHTML).toBe('7');
    setCount(5);
    // direct children are inert, dynamic expression serves to lazy evaluate
    expect(div.innerHTML).toBe('7');
    setCount(2);
    expect(div.innerHTML).toBe('');
  });

  test('dispose', () => disposer());
});

describe('Testing an only child when control flow with DOM children', () => {
  let div, disposer;
  const [count, setCount] = createSignal(0);
  const Component = () =>
    <div ref={div}><Show when={( count() >= 5 )}>
      <span>{count}</span>
      <span>counted</span>
    </Show></div>

  test('Create when control flow', () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />
    });

    expect(div.innerHTML).toBe('');
  });

  test('Toggle when control flow', () => {
    setCount(7);
    expect(div.firstChild.innerHTML).toBe('7');
    setCount(5);
    expect(div.firstChild.innerHTML).toBe('5');
    setCount(2);
    expect(div.innerHTML).toBe('');
  });

  test('dispose', () => disposer());
});

describe('Testing an only child when control flow with DOM children and fallback', () => {
  let div, disposer;
  const [count, setCount] = createSignal(0);
  const Component = () =>
    <div ref={div}><Show when={( count() >= 5 )}
      fallback={<span>Too Low</span>}
    >
      <span>{count}</span>
    </Show></div>

  test('Create when control flow', () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />
    });

    expect(div.innerHTML).toBe('<span>Too Low</span>');
  });

  test('Toggle when control flow', () => {
    setCount(7);
    expect(div.firstChild.innerHTML).toBe('7');
    setCount(5);
    expect(div.firstChild.innerHTML).toBe('5');
    setCount(2);
    expect(div.firstChild.innerHTML).toBe('Too Low');
  });

  test('dispose', () => disposer());
});