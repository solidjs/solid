import { createPlugin } from "seroval";
import {
  DEFAULT_WEB_PLUGINS,
  createHydrationSerializer,
  createJSONDeserializer,
  createSerializer,
  getLocalHeaderScript,
  resolveSerializerPlugins,
  serializeJSON
} from "../../serialization/src/serializer.js";

function collect(create, options = {}) {
  const scripts = [];
  const serializer = create({
    onData: script => scripts.push(script),
    onError: err => {
      throw err;
    },
    ...options
  });
  return { serializer, scripts };
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

const PointPlugin = createPlugin({
  tag: "test/Point",
  test(value) {
    return value instanceof Point;
  },
  parse: {
    sync(value, ctx) {
      return { x: ctx.parse(value.x), y: ctx.parse(value.y) };
    },
    stream(value, ctx) {
      return { x: ctx.parse(value.x), y: ctx.parse(value.y) };
    }
  },
  serialize(node, ctx) {
    return `new Point(${ctx.serialize(node.x)},${ctx.serialize(node.y)})`;
  },
  deserialize(node, ctx) {
    return new Point(ctx.deserialize(node.x), ctx.deserialize(node.y));
  }
});

// Matches the same values as the default URLPlugin; used to verify
// custom plugins are consulted before the defaults.
const ShadowURLPlugin = createPlugin({
  tag: "test/ShadowURL",
  test(value) {
    return value instanceof URL;
  },
  parse: {
    sync() {
      return {};
    },
    stream() {
      return {};
    }
  },
  serialize() {
    return `"__shadowed_url__"`;
  },
  deserialize() {
    return new URL("https://shadowed.example");
  }
});

describe("resolveSerializerPlugins", () => {
  it("returns the defaults when no custom plugins are given", () => {
    expect(resolveSerializerPlugins()).toEqual([...DEFAULT_WEB_PLUGINS]);
  });

  it("places custom plugins ahead of the defaults", () => {
    const resolved = resolveSerializerPlugins([PointPlugin]);
    expect(resolved[0]).toBe(PointPlugin);
    expect(resolved.slice(1)).toEqual([...DEFAULT_WEB_PLUGINS]);
  });

  it("returns a fresh array and never mutates the defaults", () => {
    const snapshot = [...DEFAULT_WEB_PLUGINS];
    const a = resolveSerializerPlugins([PointPlugin]);
    const b = resolveSerializerPlugins();
    a.push(ShadowURLPlugin);
    b.push(ShadowURLPlugin);
    expect(a).not.toBe(b);
    expect([...DEFAULT_WEB_PLUGINS]).toEqual(snapshot);
    expect(resolveSerializerPlugins()).toEqual(snapshot);
  });
});

describe("createHydrationSerializer", () => {
  it("writes values into the hydration global", () => {
    const { serializer, scripts } = collect(createHydrationSerializer);
    serializer.write("0", { hello: "world" });
    serializer.close();
    const output = scripts.join(";");
    expect(output).toContain("_$HY.r");
    expect(output).toContain('"0"');
    expect(output).toContain("hello");
  });

  it("serializes web-platform values through the default plugins", () => {
    const { serializer, scripts } = collect(createHydrationSerializer);
    serializer.write("u", new URL("https://solidjs.com/"));
    serializer.close();
    expect(scripts.join(";")).toContain("https://solidjs.com/");
  });

  it("consults custom plugins before the defaults", () => {
    const { serializer, scripts } = collect(createHydrationSerializer, {
      plugins: [ShadowURLPlugin]
    });
    serializer.write("u", new URL("https://solidjs.com/"));
    serializer.close();
    expect(scripts.join(";")).toContain("__shadowed_url__");
  });

  it("keeps plugin sets isolated between instances", () => {
    const withPoint = collect(createHydrationSerializer, { plugins: [PointPlugin] });
    const bare = collect(createHydrationSerializer);
    withPoint.serializer.write("p", new Point(1, 2));
    withPoint.serializer.close();
    expect(withPoint.scripts.join(";")).toContain("new Point(1,2)");
    expect(() => {
      bare.serializer.write("p", new Point(3, 4));
      bare.serializer.close();
    }).toThrow();
  });
});

describe("createSerializer", () => {
  it("targets the provided globalIdentifier", () => {
    const { serializer, scripts } = collect(createSerializer, {
      globalIdentifier: "self.__CUSTOM__"
    });
    serializer.write("0", [1, 2, 3]);
    serializer.close();
    const output = scripts.join(";");
    expect(output).toContain("self.__CUSTOM__");
    expect(output).not.toContain("_$HY.r");
  });

  it("downlevels post-ES2017 features by default but honors overrides", () => {
    const err = new AggregateError([new Error("a")], "boom");

    const compat = collect(createSerializer, { globalIdentifier: "self.__A__" });
    compat.serializer.write("e", err);
    compat.serializer.close();
    expect(compat.scripts.join(";")).not.toContain("new AggregateError");

    const modern = collect(createSerializer, {
      globalIdentifier: "self.__B__",
      disabledFeatures: 0
    });
    modern.serializer.write("e", err);
    modern.serializer.close();
    expect(modern.scripts.join(";")).toContain("AggregateError");
  });
});

describe("JSON codec", () => {
  // Encodes on one "peer" and decodes on another, simulating a transport
  // that frames each SerovalNode chunk (framing itself is out of scope).
  function roundtrip(value, options = {}) {
    const deserialize = createJSONDeserializer(options);
    return new Promise((resolve, reject) => {
      let result;
      serializeJSON(value, {
        ...options,
        onParse(node, initial) {
          const decoded = deserialize(JSON.parse(JSON.stringify(node)));
          if (initial) result = decoded;
        },
        onDone: () => resolve(result),
        onError: reject
      });
    });
  }

  it("roundtrips plain values", async () => {
    const source = { hello: "world", list: [1, 2n, null], nested: new Map([["a", 1]]) };
    const result = await roundtrip(source);
    expect(result).not.toBe(source);
    expect(result.hello).toBe("world");
    expect(result.list).toEqual([1, 2n, null]);
    expect(result.nested.get("a")).toBe(1);
  });

  it("roundtrips async values across multiple chunks", async () => {
    const chunkCounts = [];
    const deserialize = createJSONDeserializer();
    const result = await new Promise((resolve, reject) => {
      let initialValue;
      serializeJSON(
        { immediate: 1, eventual: Promise.resolve("later") },
        {
          onParse(node, initial) {
            chunkCounts.push(initial);
            const decoded = deserialize(JSON.parse(JSON.stringify(node)));
            if (initial) initialValue = decoded;
          },
          onDone: () => resolve(initialValue),
          onError: reject
        }
      );
    });
    expect(chunkCounts.length).toBeGreaterThan(1);
    expect(result.immediate).toBe(1);
    await expect(result.eventual).resolves.toBe("later");
  });

  it("roundtrips web-platform values through the default plugins", async () => {
    const result = await roundtrip({
      url: new URL("https://solidjs.com/"),
      params: new URLSearchParams("a=1&b=2")
    });
    expect(result.url).toBeInstanceOf(URL);
    expect(result.url.href).toBe("https://solidjs.com/");
    expect(result.params.get("b")).toBe("2");
  });

  it("supports custom plugins when both peers use them", async () => {
    const result = await roundtrip(new Point(3, 7), { plugins: [PointPlugin] });
    expect(result).toBeInstanceOf(Point);
    expect(result.x).toBe(3);
    expect(result.y).toBe(7);
  });

  it("rejects RegExp by default but allows opting back in", async () => {
    await expect(roundtrip({ re: /boom/g })).rejects.toThrow();
    const result = await roundtrip({ re: /fine/g }, { disabledFeatures: 0 });
    expect(result.re).toBeInstanceOf(RegExp);
    expect(result.re.source).toBe("fine");
  });

  it("enforces the depth limit", async () => {
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 100; i++) {
      cursor.child = {};
      cursor = cursor.child;
    }
    await expect(roundtrip(deep)).rejects.toThrow();
    await expect(roundtrip(deep, { depthLimit: 1000 })).resolves.toBeTruthy();
  });

  it("shares cross-references within one deserializer instance", async () => {
    const shared = { name: "shared" };
    const result = await roundtrip({ a: shared, b: shared });
    expect(result.a).toBe(result.b);
    expect(result.a.name).toBe("shared");
  });
});

describe("error stack stripping", () => {
  // vitest runs with NODE_ENV=test, where the mask is active (anything but
  // "development" counts as production for this policy)
  function withNodeEnv(env, fn) {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = env;
    try {
      return fn();
    } finally {
      process.env.NODE_ENV = previous;
    }
  }

  function createError() {
    function throwsDeepInsideTheServer() {
      throw new Error("boom");
    }
    try {
      throwsDeepInsideTheServer();
    } catch (error) {
      return error;
    }
  }

  function serializeNodes(value, options = {}) {
    const nodes = [];
    return new Promise((resolve, reject) => {
      serializeJSON(value, {
        ...options,
        onParse: node => nodes.push(node),
        onDone: () => resolve(nodes),
        onError: reject
      });
    });
  }

  it("omits the stack from JSON codec output outside development", async () => {
    const nodes = await serializeNodes(createError());
    const payload = JSON.stringify(nodes);
    expect(payload).toContain("boom");
    expect(payload).not.toContain("throwsDeepInsideTheServer");
    expect(payload).not.toContain("serializer.spec");
  });

  it("keeps the stack in development", async () => {
    const nodes = await withNodeEnv("development", () => serializeNodes(createError()));
    const payload = JSON.stringify(nodes);
    expect(payload).toContain("boom");
    expect(payload).toContain("throwsDeepInsideTheServer");
  });

  it("strips the stack even when disabledFeatures is overridden", async () => {
    const nodes = await serializeNodes(createError(), { disabledFeatures: 0 });
    expect(JSON.stringify(nodes)).not.toContain("throwsDeepInsideTheServer");
  });

  it("still decodes payloads that carry a stack", async () => {
    const nodes = await withNodeEnv("development", () => serializeNodes(createError()));
    const deserialize = createJSONDeserializer();
    let decoded;
    for (let i = 0; i < nodes.length; i++) {
      const value = deserialize(JSON.parse(JSON.stringify(nodes[i])));
      if (i === 0) decoded = value;
    }
    expect(decoded).toBeInstanceOf(Error);
    expect(decoded.message).toBe("boom");
    expect(decoded.stack).toContain("throwsDeepInsideTheServer");
  });

  it("serializeErrorStacks: false pins production disclosure over NODE_ENV (#3152)", async () => {
    // NODE_ENV=development against a production artifact is a quiet, common
    // misconfiguration (base images, dotenv) — and the stack it would ship
    // for a markSafeError-branded error traverses APPLICATION code, to any
    // caller who can trigger an ordinary error path. The option keys the
    // policy to the deployment, not the ambient variable.
    const nodes = await withNodeEnv("development", () =>
      serializeNodes(createError(), { serializeErrorStacks: false })
    );
    const payload = JSON.stringify(nodes);
    expect(payload).toContain("boom");
    expect(payload).not.toContain("throwsDeepInsideTheServer");
  });

  it("serializeErrorStacks: true opts stacks in without touching NODE_ENV", async () => {
    // the escape hatch in the other direction: a trusted internal tool
    // that wants stacks from its production process
    const nodes = await serializeNodes(createError(), { serializeErrorStacks: true });
    expect(JSON.stringify(nodes)).toContain("throwsDeepInsideTheServer");
  });

  it("omits the stack from hydration scripts outside development", () => {
    const { serializer, scripts } = collect(createHydrationSerializer);
    serializer.write("e", createError());
    serializer.close();
    const output = scripts.join(";");
    expect(output).toContain("boom");
    expect(output).not.toContain("throwsDeepInsideTheServer");
  });
});

describe("getLocalHeaderScript", () => {
  it("emits the cross-reference bootstrap that hydration output relies on", () => {
    const header = getLocalHeaderScript("scope1");
    expect(typeof header).toBe("string");
    expect(header.endsWith(";")).toBe(true);
    expect(header).toContain("scope1");
  });
});
