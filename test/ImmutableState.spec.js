const S = require('s-js');
const { ImmutableState } = require('../lib/solid');

describe('state.set', () => {

  test('Track a state change', () => {
    S.root(() => {
      var state = new ImmutableState({data: 2}),
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
      var state = new ImmutableState({user: {firstName: 'John', lastName: 'Smith'}}),
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
      var state = new ImmutableState({data: 2}),
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
      var state = new ImmutableState({user: {firstName: 'John', lastName: 'Smith'}}),
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
          state = new ImmutableState();

      state.select({ data });
      expect(state.data).toBe('signal');
    });
  });

  test('Select Function', () => {
    S.root(() => {
      var state = new ImmutableState();

      state.select({ data: () => 'function' });
      expect(state.data).toBe('function');
    });
  });

  test('Select Promise', (done) => {
    S.root(async () => {
      var p = new Promise(resolve => { setTimeout(resolve, 20, 'promised'); }),
        state = new ImmutableState();

      state.select({ data: p });
      await p;
      expect(state.data).toBe('promised');
      done();
    });
  });

});

describe('state.sample', () => {

  test('Sample state', () => {
    S.root(() => {
      var state = new ImmutableState({data: 2}),
        executionCount = 0;

      expect.assertions(1);
      S(() => {
        if (executionCount === 0)
          expect(state.sample('data')).toBe(2);
        else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      state.set({ data: 5 });
    });
  });

  test('Sample object state', () => {
    S.root(() => {
      var state = new ImmutableState({data: {item: 'available'}}),
        executionCount = 0;

      expect.assertions(1);
      S(() => {
        if (executionCount === 0)
          expect(state.sample('data').item).toBe('available');
        else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      state.set({ data: {item: 'new'} });
    });
  });

  test('Sample nested state', () => {
    S.root(() => {
      var state = new ImmutableState({user: {firstName: 'John', lastName: 'Smith'}}),
        executionCount = 0;

      expect.assertions(1);
      S(() => {
        if (executionCount === 0)
          expect(state.user.sample('firstName')).toBe('John');
        else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      state.set('user', {firstName: 'Jake'});

    });
  });

  test('Sample nested object state', () => {
    S.root(() => {
      var state = new ImmutableState({user: {address: {street: 'Cherry Lane'}}}),
        executionCount = 0;

      expect.assertions(1);
      S(() => {
        if (executionCount === 0)
          expect(state.user.sample('address').street).toBe('Cherry Lane');
        else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      state.set('user', {address: {street: 'Apple Orchards Rd'}});

    });
  });
});

describe('state.sample', () => {

  test('Sample state', () => {
    S.root(() => {
      var state = new ImmutableState({data: 2}),
        executionCount = 0;

      expect.assertions(1);
      S(() => {
        if (executionCount === 0)
          expect(state.sample('data')).toBe(2);
        else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      state.set({ data: 5 });
    });
  });

  test('Sample object state', () => {
    S.root(() => {
      var state = new ImmutableState({data: {item: 'available'}}),
        executionCount = 0;

      expect.assertions(1);
      S(() => {
        if (executionCount === 0)
          expect(state.sample('data').item).toBe('available');
        else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      state.set({ data: {item: 'new'} });
    });
  });

  test('Sample nested state', () => {
    S.root(() => {
      var state = new ImmutableState({user: {firstName: 'John', lastName: 'Smith'}}),
        executionCount = 0;

      expect.assertions(1);
      S(() => {
        if (executionCount === 0)
          expect(state.user.sample('firstName')).toBe('John');
        else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      state.set('user', {firstName: 'Jake'});

    });
  });

  test('Sample nested object state', () => {
    S.root(() => {
      var state = new ImmutableState({user: {address: {street: 'Cherry Lane'}}}),
        executionCount = 0;

      expect.assertions(1);
      S(() => {
        if (executionCount === 0)
          expect(state.user.sample('address').street).toBe('Cherry Lane');
        else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      state.set('user', {address: {street: 'Apple Orchards Rd'}});

    });
  });
});

