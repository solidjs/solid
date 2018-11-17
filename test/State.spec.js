const S = require('s-js');
const { State, from } = require('../lib/solid');

describe('state.set', () => {

  test('Track a state change', () => {
    S.root(() => {
      var state = new State({data: 2}),
        executionCount = 0;

      expect.assertions(2);
      S(() => {
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

      state.set({ data: 5 });

    });
  });

  test('Track a nested state change', () => {
    S.root(() => {
      var state = new State({user: {firstName: 'John', lastName: 'Smith'}}),
        executionCount = 0;

      expect.assertions(2);
      S(() => {
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

      state.set('user', {firstName: 'Jake'});

    });
  });
});

describe('state.replace', () => {

  test('Track a state replace', () => {
    S.root(() => {
      var state = new State({data: 2}),
        executionCount = 0;

      expect.assertions(2);
      S(() => {
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

      state.replace({ data: 5 });

    });
  });

  test('Track a nested state replace', () => {
    S.root(() => {
      var state = new State({user: {firstName: 'John', lastName: 'Smith'}}),
        executionCount = 0;

      expect.assertions(2);
      S(() => {
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

      state.replace('user', 'firstName', 'Jake');

    });
  });
});

describe('state.select', () => {

  test('Select Signal', () => {
    S.root(() => {
      var data = S.data('signal'),
          state = new State();

      state.select({ data });
      expect(state.data).toBe('signal');
    });
  });

  test('Select Function', () => {
    S.root(() => {
      var state = new State();

      state.select({ data: () => 'function' });
      expect(state.data).toBe('function');
    });
  });

  test('Select Promise', (done) => {
    S.root(async () => {
      var p = new Promise(resolve => { setTimeout(resolve, 20, 'promised'); }),
        state = new State();

      state.select({ data: from(p) });
      await p;
      expect(state.data).toBe('promised');
      done();
    });
  });

});