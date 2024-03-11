import {
  ContextNotFoundError,
  createContext,
  createRoot,
  getContext,
  hasContext,
  NoOwnerError,
  setContext,
} from '../src';

it('should create context', () => {
  const context = createContext(1);

  expect(context.id).toBeDefined();
  expect(context.defaultValue).toEqual(1);

  createRoot(() => {
    setContext(context);
    expect(getContext(context)).toEqual(1);
  });
});

it('should forward context across roots', () => {
  const context = createContext(1);
  createRoot(() => {
    setContext(context, 2);
    createRoot(() => {
      expect(getContext(context)).toEqual(2);
      createRoot(() => {
        expect(getContext(context)).toEqual(2);
      });
    });
  });
});

it('should not expose context on parent when set in child', () => {
  const context = createContext(1);
  createRoot(() => {
    createRoot(() => {
      setContext(context, 4);
    });

    expect(getContext(context)).toEqual(1);
  });
});

it('should return true if context has been provided', () => {
  const context = createContext();
  createRoot(() => {
    setContext(context, 1);
    expect(hasContext(context)).toBeTruthy();
  });
});

it('should return false if context has not been provided', () => {
  const context = createContext();
  createRoot(() => {
    expect(hasContext(context)).toBeFalsy();
  });
});

it('should throw error when trying to get context outside owner', () => {
  const context = createContext();
  expect(() => getContext(context)).toThrowError(NoOwnerError);
});

it('should throw error when trying to set context outside owner', () => {
  const context = createContext();
  expect(() => setContext(context)).toThrowError(NoOwnerError);
});

it('should throw error when trying to get context without setting it first', () => {
  const context = createContext();
  expect(() => createRoot(() => getContext(context))).toThrowError(
    ContextNotFoundError,
  );
});
