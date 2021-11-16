import { createEffect, createComputed, createRenderEffect, createMemo, Accessor, on } from "../src";

createEffect(
  (v?: number) => {
    return 123;
  },
  123,
  {}
);
createEffect(() => 123);
createEffect(() => {});
createEffect(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v?: number) => {}
);
createEffect(() => {
  return 123;
}, 123);
createEffect(() => {
  return 123;
}, undefined);
createEffect((v: number) => 123, 123);
createEffect((v?: number) => 123, undefined);
createEffect<number | undefined>(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v?: number) => {},
  123
);
createEffect<number | undefined>(
  // @ts-expect-error the void return is not assignable to the explicitly specified number|undefined return
  v => {},
  123
);
createEffect(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v?: number) => {},
  undefined
);
createEffect(v => {}); // useless, but ok
createEffect(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v: number) => {}
);
createEffect(
  // @ts-expect-error void return not assignable to number parameter
  (v: number) => {},
  123
);
createEffect(
  // @ts-expect-error undefined second arg is not assignable to the number parameter
  (v: number) => {},
  undefined
);
// @ts-expect-error undefined second arg is not assignable to the number parameter
createEffect((v: number) => 123, undefined);
// @ts-expect-error void not assignable to number|undefined
createEffect((v?: number) => {}, 123);

createComputed(
  (v?: number) => {
    return 123;
  },
  123,
  {}
);
createComputed(() => 123);
createComputed(() => {});
createComputed(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v?: number) => {}
);
createComputed(() => {
  return 123;
}, 123);
createComputed(() => {
  return 123;
}, undefined);
createComputed((v: number) => 123, 123);
createComputed((v?: number) => 123, undefined);
createComputed<number | undefined>(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v?: number) => {},
  123
);
createComputed<number | undefined>(
  // @ts-expect-error the void return is not assignable to the explicitly specified number|undefined return
  v => {},
  123
);
createComputed(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v?: number) => {},
  undefined
);
createComputed(v => {}); // useless, but ok
createComputed(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v: number) => {}
);
createComputed(
  // @ts-expect-error void return not assignable to number parameter
  (v: number) => {},
  123
);
createComputed(
  // @ts-expect-error undefined second arg is not assignable to the number parameter
  (v: number) => {},
  undefined
);
// @ts-expect-error undefined second arg is not assignable to the number parameter
createComputed((v: number) => 123, undefined);
// @ts-expect-error void not assignable to number|undefined
createComputed((v?: number) => {}, 123);

createRenderEffect(
  (v?: number) => {
    return 123;
  },
  123,
  {}
);
createRenderEffect(() => 123);
createRenderEffect(() => {});
createRenderEffect(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v?: number) => {}
);
createRenderEffect(() => {
  return 123;
}, 123);
createRenderEffect(() => {
  return 123;
}, undefined);
createRenderEffect((v: number) => 123, 123);
createRenderEffect((v?: number) => 123, undefined);
createRenderEffect<number | undefined>(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v?: number) => {},
  123
);
createRenderEffect<number | undefined>(
  // @ts-expect-error the void return is not assignable to the explicitly specified number|undefined return
  v => {},
  123
);
createRenderEffect(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v?: number) => {},
  undefined
);
createRenderEffect(v => {}); // useless, but ok
createRenderEffect(
  // @ts-expect-error the void return is not assignable to the number|undefined parameter
  (v: number) => {}
);
createRenderEffect(
  // @ts-expect-error void return not assignable to number parameter
  (v: number) => {},
  123
);
createRenderEffect(
  // @ts-expect-error undefined second arg is not assignable to the number parameter
  (v: number) => {},
  undefined
);
// @ts-expect-error undefined second arg is not assignable to the number parameter
createRenderEffect((v: number) => 123, undefined);
// @ts-expect-error void not assignable to number|undefined
createRenderEffect((v?: number) => {}, 123);

const v1 = createMemo(
  (v?: number) => {
    return 123;
  },
  123,
  {}
);
const v2 = createMemo(() => 123);
// @ts-expect-error number return value can not be assigned to the input string arg
const v3 = createMemo((v: string) => 123);
const v4 = createMemo(v => 123);
const v5 = createMemo(() => {});
// @ts-expect-error because void return of the effect function cannot be assigned to number | undefined of the effect function's parameter
const v6 = createMemo((v?: number) => {});
const v7 = createMemo(() => 123, 123);
const v8 = createMemo(() => 123, undefined);
const v9 = createMemo((v: number) => 123);
const v10 = createMemo((v: number) => 123, 123);
const v11 = createMemo((v?: number) => 123, 123);
const v12 = createMemo((v?: number) => 123, undefined);
const v13 = createMemo((v?: number) => 123, 123);
const v14 = createMemo<number | undefined>(
  // @ts-expect-error because void return of the effect function cannot be assigned to number | undefined of the effect function's parameter
  (v?: number) => {},
  123
);
const v15 = createMemo<number | undefined>(
  // @ts-expect-error effect function does not match the specified memo type
  v => {},
  123
);
const v16 = createMemo(
  // @ts-expect-error because void return of the effect function cannot be assigned to number | undefined of the effect function's parameter
  (v?: number) => {},
  undefined
);
const v17 = createMemo(v => {});
const v18 = createMemo(
  // @ts-expect-error because void return of the effect function cannot be assigned to number | undefined of the effect function's parameter
  (v: number) => {}
);
const v19 = createMemo(
  // @ts-expect-error void is not assignable to anything
  (v: number) => {},
  123
);
const v20 = createMemo(
  // @ts-expect-error clearly undefined can't be assigned into the input parameter of the effect function
  (v: number) => {},
  undefined
);
const v21 =
  // @ts-expect-error and this one makes complete sense, undefined cannot go into the effect function's number parameter.
  createMemo((v: number) => 123, undefined);
const v22 = createMemo(
  // @ts-expect-error because void return of the effect function cannot be assigned to number | undefined of the effect function's parameter
  (v?: number) => {},
  123
);

const m: Accessor<number> = createMemo(
  (v?: number) => {
    return 123;
  },
  123,
  {}
);
const m2: Accessor<number | undefined> = createMemo(() => 123);
// @ts-expect-error void can't be assigned to anything!
const m3: //
Accessor<undefined> = createMemo(() => {});
const m4: Accessor<void> = createMemo(() => {});
const m5: Accessor<number | undefined> = createMemo(
  // @ts-expect-error void can't be assigned to anything!
  (v?: number) => {}
);
const mm5 = createMemo(
  // @ts-expect-error void can't be assigned to anything!
  (v?: number) => {}
);
const m6: Accessor<number> = createMemo(() => 123, 123);
const m7: Accessor<number | undefined> = createMemo(() => 123, undefined);
const m8: Accessor<number> = createMemo((v: number) => 123, 123);
const m9: Accessor<number | undefined> = createMemo((v?: number) => 123, undefined);
const m10: Accessor<number | undefined> = createMemo<number | undefined>(
  // @ts-expect-error void can't be assigned to anything!
  (v?: number) => {},
  123
);
const m11: Accessor<number | undefined> = createMemo<number | undefined>(
  // @ts-expect-error void can't be assigned to anything!
  v => {},
  123
);
const m12: Accessor<number | undefined> = createMemo(
  // @ts-expect-error void can't be assigned to anything!
  (v?: number) => {},
  undefined
);
const m13 = createMemo((v?: number): number | undefined => 123, undefined);
const testm13: Accessor<number | undefined> = m13;
const m14: Accessor<number> = createMemo((v?: number): number => 123, undefined);
const m15: Accessor<number> = createMemo((v: number): number => 123);
const m16: Accessor<number> =
  // @ts-expect-error undefined initial value can't be assign to the number parameter
  createMemo((v: number): number => 123, undefined);
const m17: Accessor<number> =
  // @ts-expect-error no overload matches because the second string arg cannot be assigned to the number|boolean parameter.
  createMemo((v: number | boolean): number => 123, "asdf");
const m18: Accessor<number> = createMemo((v: number | boolean): number => 123);
const m19: Accessor<number> = createMemo((v: number | string): number => 123);
// @ts-expect-error due to the next ts-expect-error causing the return type to be inferred wrong.
const m20: Accessor<number> = createMemo(
  // @ts-expect-error because the number return cannot be assigned to the boolean|string parameter
  (v: boolean | string): number => 123
);
const m21: Accessor<number> =
  // @ts-expect-error because the second boolean arg cannot be assigned to the number|string parameter.
  createMemo((v: number | string): number => 123, true);
const m22: Accessor<number> = createMemo((v: number | string): number => 123, "asdf");
const m23: Accessor<number> = createMemo((v?: number | string): number => 123, undefined);
const m24: Accessor<number> =
  // @ts-expect-error true not assignable to number|string
  createMemo((v: number | string): number => 123, true);

const one = () => 123;
const two = () => Boolean(Math.random());
const ef = on([one, two], ([one, two], [prevOne, prevTwo], computed): number => {
  const _one: number = one;
  const _two: boolean = two;
  const _prevone: number = prevOne;
  const _prevtwo: boolean = prevTwo;
  // @ts-expect-error FIXME computed type is unknown, should be `number`.
  const _computed: number = computed;
  return one + +two;
});

// more type tests...
