import { mergeProps, splitProps } from "../src/index.js";
import { $PROXY } from "../src/reactive/signal.js";
import { bench, describe } from "vitest";

const staticDesc = {
  value: 1,
  writable: true,
  configurable: true,
  enumerable: true
};

const signalDesc = {
  get() {
    return 1;
  },
  configurable: true,
  enumerable: true
};

const cache = new Map<string, any>();

const createObject = (
  name: string,
  amount: number,
  desc: (index: number) => PropertyDescriptor
) => {
  const key = `${name}-${amount}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const proto: Record<string, any> = {};
  for (let index = 0; index < amount; ++index) proto[`${name}${index}`] = desc(index);
  const result = Object.defineProperties({}, proto) as Record<string, any>;
  cache.set(key, result);
  return result;
};

const keys = (o: Record<string, any>) => Object.keys(o);

type Test = {
  title: string;
  benchs: { title: string; func: any }[];
};

function createTest<T extends (...args: any[]) => any, G extends (...args: any[]) => any>(options: {
  name: string;
  /**
   * `vitest bench -t "FILTER"` does not work
   */
  filter?: RegExp;
  subjects: {
    name: string;
    func: T;
  }[];
  generator: Record<string, G>;
  inputs: (generator: G) => Record<string, Parameters<T>>;
}) {
  const tests: Test[] = [];
  for (const generatorName in options.generator) {
    const generator = options.generator[generatorName];
    const inputs = options.inputs(generator);
    for (const inputName in inputs) {
      const args = inputs[inputName];
      const test: Test = {
        title: `${options.name}-${generatorName}${inputName}`,
        benchs: []
      };
      if (options.filter && !options.filter.exec(test.title)) continue;
      for (const subject of options.subjects) {
        test.benchs.push({
          title: subject.name,
          func: () => subject.func(...args)
        });
      }
      tests.push(test);
    }
  }
  return tests;
}

type SplitProps = (...args: any[]) => Record<string, any>[];

const generator = {
  static: (amount: number) => createObject("static", amount, () => staticDesc),
  signal: (amount: number) => createObject("signal", amount, () => signalDesc),
  mixed: (amount: number) => createObject("mixed", amount, v => (v % 2 ? staticDesc : signalDesc)),
  store: (amount: number) => {
    const data = createObject("store", amount, () => staticDesc);
    // Create a proxy that mimics store behavior with $PROXY symbol
    const proxy = new Proxy(data, {
      get(target, property) {
        if (property === $PROXY) return proxy;
        return target[property];
      },
      has(target, property) {
        if (property === $PROXY) return true;
        return property in target;
      },
      ownKeys(target) {
        return Reflect.ownKeys(target);
      }
    });
    Object.defineProperty(data, $PROXY, { value: proxy, configurable: true });
    return proxy;
  }
} as const;

const filter = new RegExp(process.env.FILTER || ".+");

const splitPropsTests = createTest({
  filter,
  name: "splitProps",
  subjects: [
    {
      name: "splitProps",
      func: splitProps as SplitProps
    }
  ],
  generator,
  inputs: g => ({
    "(5, 1)": [g(5), keys(g(1))],
    "(2, 15)": [g(2), keys(g(15))],
    "(2, 100)": [g(2), keys(g(100))],
    "(0, 15)": [g(0), keys(g(15))],
    "(25, 5)": [g(25), keys(g(5))],
    "(25, 100)": [g(25), keys(g(100))],
    "(50, 100)": [g(50), keys(g(100))],
    "(100, 25)": [g(100), keys(g(25))],
    "(5, 1, 2)": [g(5), keys(g(1)), keys(g(2))],
    "(2, 3, 2)": [g(2), keys(g(3)), keys(g(2))],
    "(2, 100, 3, 2)": [g(2), keys(g(100)), keys(g(3)), keys(g(2))]
  })
});

const mergePropsTest = createTest({
  name: "mergeProps",
  filter,
  subjects: [
    {
      name: "mergeProps",
      func: mergeProps
    }
  ],
  generator,
  inputs: g => ({
    "(5, 1)": [g(5), g(1)],
    "(2, 15)": [g(2), g(15)],
    "(2, 100)": [g(2), g(100)],
    "(0, 15)": [g(0), g(15)],
    "(25, 5)": [g(25), g(5)],
    "(25, 100)": [g(25), g(100)],
    "(50, 100)": [g(50), g(100)],
    "(100, 25)": [g(100), g(25)],
    "(5, 1, 2)": [g(5), g(1), g(2)],
    "(2, 3, 2)": [g(2), g(3), g(2)],
    "(2, 100, 3, 2)": [g(2), g(100), g(3), g(2)]
  })
});

for (const test of splitPropsTests) {
  describe(test.title, () => {
    for (const { title, func } of test.benchs) bench(title, func);
  });
}

for (const test of mergePropsTest) {
  describe(test.title, () => {
    for (const { title, func } of test.benchs) bench(title, func);
  });
}
