import { bench } from "vitest";
import { createStore, merge, omit } from "../../src/index.js";

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
const storeCache = new Map<string, any>();

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

const createStoreObject = (amount: number) => {
  const key = `store-${amount}`;
  const cached = storeCache.get(key);
  if (cached) return cached;
  const data: Record<string, number> = {};
  for (let index = 0; index < amount; ++index) data[`store${index}`] = 1;
  const [state] = createStore(data);
  storeCache.set(key, state);
  return state;
};

type Test = {
  title: string;
  benchs: { title: string; func: any }[];
};

function createTest<G extends (...args: any[]) => any>(options: {
  name: string;
  /**
   * `vitest bench -t "FILTER"` does not work
   */
  filter?: RegExp;
  subjects: {
    name: string;
    func: (...args: any[]) => any;
  }[];
  generator: Record<string, G>;
  inputs: (generator: G) => Record<string, any[]>;
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

type omit = (...args: any[]) => Record<string, any>[];

const generator = {
  static: (amount: number) => createObject("static", amount, () => staticDesc),
  signal: (amount: number) => createObject("signal", amount, () => signalDesc),
  mixed: (amount: number) => createObject("mixed", amount, v => (v % 2 ? staticDesc : signalDesc))
} as const;

const filter = new RegExp(process.env.FILTER || ".+");

const omitTests = createTest({
  filter,
  name: "omit",
  subjects: [
    {
      name: "omit",
      func: omit as omit
    }
  ],
  generator,
  inputs: g => ({
    "(5, 1)": [g(5), ...keys(g(1))],
    "(5, 1, 2)": [g(5), ...keys(g(1)), ...keys(g(2))],
    "(0, 15)": [g(0), ...keys(g(15))],
    "(0, 3, 2)": [g(0), ...keys(g(3)), ...keys(g(2))],
    "(0, 100)": [g(0), ...keys(g(100))],
    "(0, 100, 3, 2)": [g(0), ...keys(g(100)), ...keys(g(3)), ...keys(g(2))],
    "(25, 100)": [g(25), ...keys(g(100))],
    "(50, 100)": [g(50), ...keys(g(100))],
    "(100, 25)": [g(100), ...keys(g(25))]
  })
});

const mergeTest = createTest({
  name: "merge",
  filter,
  subjects: [
    {
      name: "merge",
      func: merge
    }
  ],
  generator,
  inputs: g => ({
    "(5, 1)": [g(5), g(1)],
    "(5, 1, 2)": [g(5), g(1), g(2)],
    "(0, 15)": [g(0), g(15)],
    "(0, 3, 2)": [g(0), g(3), g(2)],
    "(0, 100)": [g(0), g(100)],
    "(0, 100, 3, 2)": [g(0), g(100), g(3), g(2)],
    "(25, 100)": [g(25), g(100)],
    "(50, 100)": [g(50), g(100)],
    "(100, 25)": [g(100), g(25)]
  })
});

const mergeMergeTest = createTest({
  name: "merge-merge",
  filter,
  subjects: [
    {
      name: "merge",
      func: merge
    }
  ],
  generator,
  inputs: g => ({
    "(left 5, 1, 2)": [merge(g(5), g(1)), g(2)],
    "(right 5, 1, 2)": [g(5), merge(g(1), g(2))],
    "(both 5, 1, 3, 2)": [merge(g(5), g(1)), merge(g(3), g(2))],
    "(deep 0, 100, 3, 2)": [merge(merge(g(0), g(100)), g(3)), g(2)],
    "(covered 100, 25, 5)": [merge(g(100), g(25)), g(5)]
  })
});

const storeGenerator = {
  store: createStoreObject
} as const;

const omitProxyTest = createTest({
  name: "omit-proxy",
  filter,
  subjects: [
    {
      name: "construct",
      func: (props: Record<string, any>, _rest: Record<string, any>, omitKeys: string[]) =>
        omit(props, ...omitKeys)
    },
    {
      name: "readAllowed",
      func: (
        _props: Record<string, any>,
        rest: Record<string, any>,
        _omitKeys: string[],
        allowed: string
      ) => rest[allowed]
    },
    {
      name: "readBlocked",
      func: (
        _props: Record<string, any>,
        rest: Record<string, any>,
        _omitKeys: string[],
        _allowed: string,
        blocked: string
      ) => rest[blocked]
    },
    {
      name: "hasAllowed",
      func: (
        _props: Record<string, any>,
        rest: Record<string, any>,
        _omitKeys: string[],
        allowed: string
      ) => allowed in rest
    },
    {
      name: "ownKeys",
      func: (_props: Record<string, any>, rest: Record<string, any>) => Object.keys(rest)
    }
  ],
  generator: storeGenerator,
  inputs: g => {
    const store25 = g(25),
      store100 = g(100),
      keys5 = keys(g(5)),
      keys25 = keys(g(25)),
      keys50 = keys(g(50));
    return {
      "(25, 5)": [store25, omit(store25, ...keys5), keys5, "store10", "store0"],
      "(100, 5)": [store100, omit(store100, ...keys5), keys5, "store50", "store0"],
      "(100, 25)": [store100, omit(store100, ...keys25), keys25, "store50", "store0"],
      "(100, 50)": [store100, omit(store100, ...keys50), keys50, "store75", "store0"]
    };
  }
});

const mergeProxyKeysTest = createTest({
  name: "merge-proxy-keys",
  filter,
  subjects: [
    {
      name: "construct",
      func: (defaults: Record<string, any>, props: Record<string, any>) => merge(defaults, props)
    },
    {
      name: "ownKeys",
      func: (
        _defaults: Record<string, any>,
        _props: Record<string, any>,
        merged: Record<string, any>
      ) => Object.keys(merged)
    },
    {
      name: "read",
      func: (
        _defaults: Record<string, any>,
        _props: Record<string, any>,
        merged: Record<string, any>,
        property: string
      ) => merged[property]
    }
  ],
  generator: storeGenerator,
  inputs: g => ({
    "(defaults 5, props 25)": [
      createObject("store", 5, () => staticDesc),
      g(25),
      merge(
        createObject("store", 5, () => staticDesc),
        g(25)
      ),
      "store10"
    ],
    "(defaults 25, props 100)": [
      createObject("store", 25, () => staticDesc),
      g(100),
      merge(
        createObject("store", 25, () => staticDesc),
        g(100)
      ),
      "store50"
    ],
    "(defaults 100, props 25)": [
      createObject("store", 100, () => staticDesc),
      g(25),
      merge(
        createObject("store", 100, () => staticDesc),
        g(25)
      ),
      "store50"
    ],
    "(defaults 100, props 100)": [
      createObject("store", 100, () => staticDesc),
      g(100),
      merge(
        createObject("store", 100, () => staticDesc),
        g(100)
      ),
      "store50"
    ]
  })
});

for (const test of omitTests) {
  describe(test.title, () => {
    for (const { title, func } of test.benchs) bench(title, func);
  });
}

for (const test of mergeTest) {
  describe(test.title, () => {
    for (const { title, func } of test.benchs) bench(title, func);
  });
}

for (const test of mergeMergeTest) {
  describe(test.title, () => {
    for (const { title, func } of test.benchs) bench(title, func);
  });
}

for (const test of omitProxyTest) {
  describe(test.title, () => {
    for (const { title, func } of test.benchs) bench(title, func);
  });
}

for (const test of mergeProxyKeysTest) {
  describe(test.title, () => {
    for (const { title, func } of test.benchs) bench(title, func);
  });
}
