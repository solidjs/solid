import {
  createEffect,
  createComputed,
  createRenderEffect,
  createMemo,
  Accessor,
  on,
  createSignal
  // } from "../types/index";
} from "../src";

class Animal {
  #animal = null;
}
class Dog extends Animal {
  #dog = null;
}

//////////////////////////////////////////////////////////////////////////
// createEffect ////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

createEffect(() => {
  return "hello";
}, "init");

createEffect(prev => {
  // @ts-expect-error FIXME prev is inferred as unknown, so not assignable to string|number. Can we make it inferred?
  const p: string = prev;
  return p + "hello";
}, "init");

createEffect((prev: string) => {
  const p: string = prev;
  return p + "hello";
}, "init");

createEffect(() => {
  return "hello";
}, 123);

createEffect(prev => {
  // @ts-expect-error FIXME prev is inferred as unknown, so not assignable to string|number. Can we make it inferred?
  const p: string = prev;
  return p + "hello";
}, 123);

createEffect((prev: number | string) => {
  const p: number | string = prev;
  return p + "hello";
}, 123);

createEffect(() => {
  return "hello";
});

createEffect(_prev => {
  return "hello";
});

createEffect(_prev => {});

createEffect((v: number | string): number => 123, "asdf");

createEffect((num: number | undefined): number | undefined => 123);

createEffect((num?: number): number | undefined => 123);

createEffect<number>((v: number | string): number => 123, 123);
createEffect<number | string>((v: number | string): number => 123, 123);

// @ts-expect-error undefined initial value not assignable to input parameter
createEffect((v: number | boolean): number | boolean => false);

createEffect((v: Animal): Dog => new Dog(), new Dog());
createEffect((v: Animal): Dog => new Dog(), new Animal());
createEffect(
  // @ts-expect-error the Animal arg is not assignable to the Dog parameter
  (v: Dog): Dog => new Dog(),
  new Animal()
);
// @ts-expect-error the missing second arg is undefined, and undefined is not assignable to the Animal parameter
createEffect((v: Animal): Dog => new Dog());

createEffect<number | boolean>(
  // @ts-expect-error because if number|boolean were returnable from the passed-in function, it wouldn't be assignable to the input of that function.
  // TODO can we improve this? Technically, the return type of the function is always assignable to number|boolean, which is really all we should care about.
  (v: number | string): number => 123,
  123
);

createEffect((v: number | string): number => 123, "asdf");

createEffect((v: number) => 123, 123);

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
// @ts-expect-error undefined initial value is not assignable to the number parameter
createEffect((v: number) => 123);
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
// @ts-expect-error the void return is not assignable to the number|undefined parameter
createEffect((v: number) => {});
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

//////////////////////////////////////////////////////////////////////////
// createComputed ////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

createComputed(() => {
  return "hello";
}, "init");

createComputed(prev => {
  // @ts-expect-error FIXME prev is inferred as unknown, so not assignable to string|number. Can we make it inferred?
  const p: string = prev;
  return p + "hello";
}, "init");

createComputed((prev: string) => {
  const p: string = prev;
  return p + "hello";
}, "init");

createComputed(() => {
  return "hello";
}, 123);

createComputed(prev => {
  // @ts-expect-error FIXME prev is inferred as unknown, so not assignable to string|number. Can we make it inferred?
  const p: string = prev;
  return p + "hello";
}, 123);

createComputed((prev: number | string) => {
  const p: number | string = prev;
  return p + "hello";
}, 123);

createComputed(() => {
  return "hello";
});

createComputed(_prev => {
  return "hello";
});

createComputed(_prev => {});

createComputed((v: number | string): number => 123, "asdf");

createComputed((num: number | undefined): number | undefined => 123);

createComputed((num?: number): number | undefined => 123);

createComputed<number>((v: number | string): number => 123, 123);
createComputed<number | string>((v: number | string): number => 123, 123);

// @ts-expect-error undefined initial value not assignable to input parameter
createComputed((v: number | boolean): number | boolean => false);

createComputed((v: Animal): Dog => new Dog(), new Dog());
createComputed((v: Animal): Dog => new Dog(), new Animal());
createComputed(
  // @ts-expect-error the Animal arg is not assignable to the Dog parameter
  (v: Dog): Dog => new Dog(),
  new Animal()
);
// @ts-expect-error the missing second arg is undefined, and undefined is not assignable to the Animal parameter
createComputed((v: Animal): Dog => new Dog());

createComputed<number | boolean>(
  // @ts-expect-error because if number|boolean were returnable from the passed-in function, it wouldn't be assignable to the input of that function.
  // TODO can we improve this? Technically, the return type of the function is always assignable to number|boolean, which is really all we should care about.
  (v: number | string): number => 123,
  123
);

createComputed((v: number | string): number => 123, "asdf");

createComputed((v: number) => 123, 123);

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
// @ts-expect-error undefined initial value is not assignable to the number parameter
createComputed((v: number) => 123);
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
// @ts-expect-error the void return is not assignable to the number|undefined parameter
createComputed((v: number) => {});
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

//////////////////////////////////////////////////////////////////////////
// createRenderEffect ////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

createRenderEffect(() => {
  return "hello";
}, "init");

createRenderEffect(prev => {
  // @ts-expect-error FIXME prev is inferred as unknown, so not assignable to string|number. Can we make it inferred?
  const p: string = prev;
  return p + "hello";
}, "init");

createRenderEffect((prev: string) => {
  const p: string = prev;
  return p + "hello";
}, "init");

createRenderEffect(() => {
  return "hello";
}, 123);

createRenderEffect(prev => {
  // @ts-expect-error FIXME prev is inferred as unknown, so not assignable to string|number. Can we make it inferred?
  const p: string = prev;
  return p + "hello";
}, 123);

createRenderEffect((prev: number | string) => {
  const p: number | string = prev;
  return p + "hello";
}, 123);

createRenderEffect(() => {
  return "hello";
});

createRenderEffect(_prev => {
  return "hello";
});

createRenderEffect(_prev => {});

createRenderEffect((v: number | string): number => 123, "asdf");

createRenderEffect((num: number | undefined): number | undefined => 123);

createRenderEffect((num?: number): number | undefined => 123);

createRenderEffect<number>((v: number | string): number => 123, 123);
createRenderEffect<number | string>((v: number | string): number => 123, 123);

// @ts-expect-error undefined initial value not assignable to input parameter
createRenderEffect((v: number | boolean): number | boolean => false);

createRenderEffect((v: Animal): Dog => new Dog(), new Dog());
createRenderEffect((v: Animal): Dog => new Dog(), new Animal());
createRenderEffect(
  // @ts-expect-error the Animal arg is not assignable to the Dog parameter
  (v: Dog): Dog => new Dog(),
  new Animal()
);
// @ts-expect-error the missing second arg is undefined, and undefined is not assignable to the Animal parameter
createRenderEffect((v: Animal): Dog => new Dog());

createRenderEffect<number | boolean>(
  // @ts-expect-error because if number|boolean were returnable from the passed-in function, it wouldn't be assignable to the input of that function.
  // TODO can we improve this? Technically, the return type of the function is always assignable to number|boolean, which is really all we should care about.
  (v: number | string): number => 123,
  123
);

createRenderEffect((v: number | string): number => 123, "asdf");

createRenderEffect((v: number) => 123, 123);

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
// @ts-expect-error undefined initial value is not assignable to the number parameter
createRenderEffect((v: number) => 123);
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
// @ts-expect-error the void return is not assignable to the number|undefined parameter
createRenderEffect((v: number) => {});
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

//////////////////////////////////////////////////////////////////////////
// createMemo ////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

createMemo((v: number | string): number => 123, "asdf");

createMemo((num: number | undefined): number | undefined => 123);

// Return type should be `Accessor<number | undefined>`
// Not sure how to write a test for this, becacuse `Accessor<number>` is assignable to `Accessor<number | undefined>`.
let c1 = createMemo((num?: number): number | undefined => undefined);
let n = c1();
// @ts-expect-error n might be undefined
const n2 = n + 3; // n is undefined

createMemo<number>((v: number | string): number => 123, 123);
createMemo<number | string>((v: number | string): number => 123, 123);

// @ts-expect-error undefined initial value not assignable to input parameter
createMemo((v: number | boolean): number | boolean => false);

createMemo((v: Animal): Dog => new Dog(), new Dog());
createMemo((v: Animal): Dog => new Dog(), new Animal());
createMemo(
  // @ts-expect-error the Animal arg is not assignable to the Dog parameter
  (v: Dog): Dog => new Dog(),
  new Animal()
);
// @ts-expect-error the missing second arg is undefined, and undefined is not assignable to the Animal parameter
createMemo((v: Animal): Dog => new Dog());

createMemo<number | boolean>(
  // @ts-expect-error because if number|boolean were returnable from the passed-in function, it wouldn't be assignable to the input of that function.
  // TODO can we improve this? Technically, the return type of the function is always assignable to number|boolean, which is really all we should care about.
  (v: number | string): number => 123,
  123
);

createMemo((v: number | string): number => 123, "asdf");

createMemo((v: number) => 123, 123);

const mv0 = createMemo(() => {
  return "hello";
}, "init");
const mv0t: string = mv0();

const mv1 = createMemo(prev => {
  // @ts-expect-error FIXME prev is inferred as unknown, so not assignable to string|number. Can we make it inferred?
  const p: string = prev;
  return p + "hello";
}, "init");
const mv1t: string = mv1();

const mv11 = createMemo((prev: string) => {
  const p: string = prev;
  return p + "hello";
}, "init");
const mv11t: string = mv11();

const mv2 = createMemo(() => {
  return "hello";
}, 123);
const mv2t: string = mv2();

const mv3 = createMemo(prev => {
  // @ts-expect-error FIXME prev is inferred as unknown, so not assignable to string|number. Can we make it inferred?
  const p: string | number = prev;
  return p + "hello";
}, 123);
const mv3t: string = mv3();

const mv31 = createMemo((prev: string | number) => {
  const p: string | number = prev;
  return p + "hello";
}, 123);
const mv31t: string = mv31();

const mv4 = createMemo(() => {
  return "hello";
});
const mv4t: string = mv4();

const mv5 = createMemo(_prev => {
  return "hello";
});
const mv5t: string = mv5();

const mv6 = createMemo(() => {});
const mv6t: void = mv6();

const mv7 = createMemo(_prev => {});
const mv7t: void = mv7();

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
// @ts-expect-error undefined initial value is not assignable to the number parameter
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
// @ts-expect-error because void return of the effect function cannot be assigned to number | undefined of the effect function's parameter
const v18 = createMemo((v: number) => {});
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
const m15: Accessor<number> =
  // @ts-expect-error undefined initial value is not assignable to the number parameter
  createMemo((v: number): number => 123);
const m16: Accessor<number> =
  // @ts-expect-error undefined initial value can't be assign to the number parameter
  createMemo((v: number): number => 123, undefined);
const m17: Accessor<number> =
  // @ts-expect-error no overload matches because the second string arg cannot be assigned to the number|boolean parameter.
  createMemo((v: number | boolean): number => 123, "asdf");
const m18: Accessor<number> =
  // @ts-expect-error undefined initial value is not assignable to the number parameter
  createMemo((v: number | boolean): number => 123);
const m19: Accessor<number> =
  // @ts-expect-error undefined initial value is not assignable to the number parameter
  createMemo((v: number | string): number => 123);
// @ts-expect-error because the number return cannot be assigned to the boolean|string parameter
const m20: Accessor<number> =
  // @ts-expect-error because the number return cannot be assigned to the boolean|string parameter
  createMemo((v: boolean | string): number => 123);
const m21: Accessor<number> =
  // @ts-expect-error because the second boolean arg cannot be assigned to the number|string parameter.
  createMemo((v: number | string): number => 123, true);
const m22: Accessor<number> = createMemo((v: number | string): number => 123, "asdf");
const m23: Accessor<number> = createMemo((v?: number | string): number => 123, undefined);
const m24: Accessor<number> =
  // @ts-expect-error true not assignable to number|string
  createMemo((v: number | string): number => 123, true);

const asdf = createMemo<number | undefined>(() => num());
// @ts-expect-error Accessor<number | undefined> is not assignable to Accessor<number>
const asdf2: //
Accessor<number> = asdf;

//////////////////////////////////////////////////////////////////////////
// on ////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

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

//////////////////////////////////////////////////////////////////////////
// test explicit generic args ////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

const [num, setN] = createSignal(1);
const [bool, setBool] = createSignal(true);

const a1: Accessor<number> = createMemo<number>(() => num());
createEffect<number>(() => num());
createComputed<number>(() => num());
createRenderEffect<number>(() => num());

const a11: Accessor<number> = createMemo<number>((v?: number) => num());
createEffect<number>((v?: number) => num());
createComputed<number>((v?: number) => num());
createRenderEffect<number>((v?: number) => num());

const a12: Accessor<number> = createMemo<number>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createEffect<number>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createComputed<number>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createRenderEffect<number>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);

//

const a2: Accessor<number | undefined> = createMemo<number | undefined>(() => num());
createEffect<number | undefined>(() => num());
createComputed<number | undefined>(() => num());
createRenderEffect<number | undefined>(() => num());

const a21: Accessor<number | undefined> = createMemo<number | undefined>((v?: number) => num());
createEffect<number | undefined>((v?: number) => num());
createComputed<number | undefined>((v?: number) => num());
createRenderEffect<number | undefined>((v?: number) => num());

const a22: Accessor<number | undefined> = createMemo<number | undefined>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createEffect<number | undefined>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createComputed<number | undefined>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createRenderEffect<number | undefined>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);

//

const a3: Accessor<number | boolean> = createMemo<number | boolean>(() => bool());
createEffect<number | boolean>(() => bool());
createComputed<number | boolean>(() => bool());
createRenderEffect<number | boolean>(() => bool());

// FIXME
// @ts-expect-error this rare edge cases is not handled yet. The number return from the effect function should be assignable to number|boolean, while the initial value should be inferred as number|undefined.
const a31: Accessor<number | boolean> = createMemo<number | boolean>((v?: number) => num());
// @ts-expect-error this rare edge cases is not handled yet. The number return from the effect function should be assignable to number|boolean, while the initial value should be inferred as number|undefined.
createEffect<number | boolean>((v?: number) => num());
// @ts-expect-error this rare edge cases is not handled yet. The number return from the effect function should be assignable to number|boolean, while the initial value should be inferred as number|undefined.
createComputed<number | boolean>((v?: number) => num());
// @ts-expect-error this rare edge cases is not handled yet. The number return from the effect function should be assignable to number|boolean, while the initial value should be inferred as number|undefined.
createRenderEffect<number | boolean>((v?: number) => num());

const a32: Accessor<number | boolean> = createMemo<number | boolean>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createEffect<number | boolean>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createComputed<number | boolean>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createRenderEffect<number | boolean>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);

//

const a4: Accessor<number | boolean> = createMemo<number | boolean>(() => bool());
createEffect<number | boolean>(() => bool());
createComputed<number | boolean>(() => bool());
createRenderEffect<number | boolean>(() => bool());

// FIXME
// @ts-expect-error this rare edge cases is not handled yet. The number return from the effect function should be assignable to number|boolean, while the initial value should be inferred as number|undefined.
const a41: Accessor<number | boolean> = createMemo<number | boolean>((v?: number) => num());
// @ts-expect-error this rare edge cases is not handled yet. The number return from the effect function should be assignable to number|boolean, while the initial value should be inferred as number|undefined.
createEffect<number | boolean>((v?: number) => num());
// @ts-expect-error this rare edge cases is not handled yet. The number return from the effect function should be assignable to number|boolean, while the initial value should be inferred as number|undefined.
createComputed<number | boolean>((v?: number) => num());
// @ts-expect-error this rare edge cases is not handled yet. The number return from the effect function should be assignable to number|boolean, while the initial value should be inferred as number|undefined.
createRenderEffect<number | boolean>((v?: number) => num());

const a42: Accessor<number | boolean> = createMemo<number | boolean>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createEffect<number | boolean>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createComputed<number | boolean>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);
createRenderEffect<number | boolean>(
  // @ts-expect-error the function accepts only `number` but the initial value will be `undefined`.
  (v: number) => num()
);

//

const a5: Accessor<number | boolean> = createMemo<number | boolean>(() => bool(), false);
createEffect<number | boolean>(() => bool(), false);
createComputed<number | boolean>(() => bool(), false);
createRenderEffect<number | boolean>(() => bool(), false);

// 👽
const a51: Accessor<number | boolean> = createMemo<number | boolean>(
  () => bool(),
  // @ts-expect-error FIXME edge case: string is not assignable to to number|boolean, but really it should say that the effect function expects 0 args but 1 arg was provided.
  "foo"
);
createEffect<number | boolean>(
  () => bool(),
  // @ts-expect-error FIXME edge case: string is not assignable to to number|boolean, but really it should say that the effect function expects 0 args but 1 arg was provided.
  "foo"
);
createComputed<number | boolean>(
  () => bool(),
  // @ts-expect-error FIXME edge case: string is not assignable to to number|boolean, but really it should say that the effect function expects 0 args but 1 arg was provided.
  "foo"
);
createRenderEffect<number | boolean>(
  () => bool(),
  // @ts-expect-error FIXME edge case: string is not assignable to to number|boolean, but really it should say that the effect function expects 0 args but 1 arg was provided.
  "foo"
);

//////////////////////////////////////////////////////////////////////////
// on ////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

//

const a6: Accessor<number | boolean> = createMemo<number | boolean>(
  () =>
    // @ts-expect-error string return is not assignable to number|boolean
    "foo"
);
createEffect<number | boolean>(
  () =>
    // @ts-expect-error string return is not assignable to number|boolean
    "foo"
);
createComputed<number | boolean>(
  () =>
    // @ts-expect-error string return is not assignable to number|boolean
    "foo"
);
createRenderEffect<number | boolean>(
  () =>
    // @ts-expect-error string return is not assignable to number|boolean
    "foo"
);

// more type tests...
