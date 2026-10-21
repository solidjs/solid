import {
  ContextNotFoundError,
  createContext,
  createRoot,
  getContext,
  NoOwnerError,
  setContext
} from "../src/index.js";

it("should create context", () => {
  const context = createContext(1);

  expect(context.id).toBeDefined();
  expect(context.defaultValue).toEqual(1);

  createRoot(() => {
    setContext(context);
    expect(getContext(context)).toEqual(1);
  });
});

it("should forward context across roots", () => {
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

it("should not expose context on parent when set in child", () => {
  const context = createContext(1);
  createRoot(() => {
    createRoot(() => {
      setContext(context, 4);
    });

    expect(getContext(context)).toEqual(1);
  });
});

it("should throw error when trying to get context outside owner", () => {
  const context = createContext();
  expect(() => getContext(context)).toThrowError(NoOwnerError);
});

it("should throw error when trying to set context outside owner", () => {
  const context = createContext();
  expect(() => setContext(context)).toThrowError(NoOwnerError);
});

it("should throw error when trying to get context without setting it first", () => {
  const context = createContext();
  expect(() => createRoot(() => getContext(context))).toThrowError(ContextNotFoundError);
});

// #4181: `undefined` means "not provided" for context — no default, an
// explicit `createContext(undefined)`, or a provider passing `undefined` — so
// each throws ContextNotFoundError. Dev messages name the context, say which
// case it is, and point at `null` as the explicit empty value.
describe("ContextNotFoundError dev messages (#4181)", () => {
  const messageOf = (read: () => unknown) => {
    try {
      createRoot(read);
    } catch (err) {
      expect(err).toBeInstanceOf(ContextNotFoundError);
      return (err as Error).message;
    }
    throw new Error("expected the read to throw");
  };

  it("default-less, no provider: says so and suggests a null default", () => {
    const context = createContext<number>();
    expect(messageOf(() => getContext(context))).toBe(
      "Context has no provider above this read and no default value. Mount a provider above this read, or create the context with a default; for an optional context, use `null` as the empty default (`createContext<T | null>(null)`), not `undefined`."
    );
  });

  it("explicit undefined default: says undefined is not a default", () => {
    const Opt = createContext<string | undefined>(undefined, "Opt");
    expect(messageOf(() => getContext(Opt))).toBe(
      'Context "Opt" has no provider above this read, and `createContext(undefined)` does not give it a default: `undefined` means "no value" for context. Mount a provider above this read, or use `null` as an explicit empty default: `createContext<T | null>(null)`.'
    );
  });

  it("a provider passing undefined: says it counts as not provided", () => {
    const Opt = createContext<string | undefined>(undefined, "Opt");
    expect(
      messageOf(() => {
        setContext(Opt, undefined);
        createRoot(() => getContext(Opt));
      })
    ).toBe(
      'Context "Opt" was provided with `undefined`, which counts as not provided: `undefined` means "no value" for context. To provide an empty value, create the context with a `null` default (`createContext<T | null>(null)`) and pass `null`.'
    );
  });

  it("null is a value: a null default and a provided null both read back", () => {
    const OptNull = createContext<string | null>(null, "OptNull");
    createRoot(() => expect(getContext(OptNull)).toBeNull());
    const NoDefault = createContext<string | null>();
    createRoot(() => {
      setContext(NoDefault, null);
      expect(getContext(NoDefault)).toBeNull();
    });
  });

  it("a ContextNotFoundError constructed without a context keeps the generic message", () => {
    expect(new ContextNotFoundError().message).toBe(
      "Context must either be created with a default value or a value must be provided before accessing it."
    );
  });
});
