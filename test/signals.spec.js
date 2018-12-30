const { root, useState, useSignal, useEffect, reconcile } = require('../lib/solid');

describe('setState', () => {

  test('Track a state change', () => {
    root(() => {
      var [state, setState] = useState({data: 2}),
        executionCount = 0;

      expect.assertions(2);
      useEffect(() => {
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
    root(() => {
      var [state, setState] = useState({user: {firstName: 'John', lastName: 'Smith'}}),
        executionCount = 0;

      expect.assertions(2);
      useEffect(() => {
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
    root(() => {
      var [state, setState] = useState({ data: 2 }),
        executionCount = 0;

      expect.assertions(2);
      useEffect(() => {
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
      setState(reconcile('data', 5));
    });
  });
});

describe('useEffect', () => {

  test('Setting state from signal', () => {
    root(() => {
      var [ getData, setData ] = useSignal('init'),
        [ state, setState ] = useState({});
      useEffect(() => setState('data', getData()));
      setData('signal')
      expect(state.data).toBe('signal');
    });
  });

  test('Select Promise', (done) => {
    root(async () => {
      var p = new Promise(resolve => { setTimeout(resolve, 20, 'promised'); }),
        [ state, setState ] = useState({});
      useEffect(() => p.then(v => setState('data', v)));
      await p;
      expect(state.data).toBe('promised');
      done();
    });
  });

});