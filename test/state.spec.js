const { createRoot, createState, createSignal, createEffect, reconcile } = require('../lib/solid');

describe('setState', () => {

  test('Track a state change', () => {
    createRoot(() => {
      var [state, setState] = createState({data: 2}),
        executionCount = 0;

      expect.assertions(2);
      createEffect(() => {
        if (executionCount === 0)
          expect(state.data).toBe(2);
        else if (executionCount === 1) {
          expect(state.data).toBe(5);
        } else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      setState({ data: 5 });

    });
  });

  test('Track a nested state change', () => {
    createRoot(() => {
      var [state, setState] = createState({user: {firstName: 'John', lastName: 'Smith'}}),
        executionCount = 0;

      expect.assertions(2);
      createEffect(() => {
        if (executionCount === 0)
          expect(state.user.firstName).toBe('John');
        else if (executionCount === 1) {
          expect(state.user.firstName).toBe('Jake');
        } else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      setState('user', 'firstName', 'Jake');

    });
  });
});

describe('setState with reconcile', () => {

  test('Track a state reconcile', () => {
    createRoot(() => {
      var [state, setState] = createState({ data: 2, missing: 'soon' }),
        executionCount = 0;

      expect.assertions(4);
      createEffect(() => {
        if (executionCount === 0) {
          expect(state.data).toBe(2);
          expect(state.missing).toBe('soon');
        } else if (executionCount === 1) {
          expect(state.data).toBe(5);
          expect(state.missing).toBe(undefined);
        } else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });
      setState(reconcile({'data': 5}));
    });
  });
});

describe('createEffect', () => {

  test('Setting state from signal', () => {
    createRoot(() => {
      var [ getData, setData ] = createSignal('init'),
        [ state, setState ] = createState({});
      createEffect(() => setState('data', getData()));
      setData('signal')
      expect(state.data).toBe('signal');
    });
  });

  test('Select Promise', (done) => {
    createRoot(async () => {
      var p = new Promise(resolve => { setTimeout(resolve, 20, 'promised'); }),
        [ state, setState ] = createState({});
      createEffect(() => p.then(v => setState('data', v)));
      await p;
      expect(state.data).toBe('promised');
      done();
    });
  });

});