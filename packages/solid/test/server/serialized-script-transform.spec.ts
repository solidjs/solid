import { runInNewContext } from "node:vm";
import { createPlugin, type SerovalNode } from "seroval";
import { createComponent, createResource, ErrorBoundary, Suspense } from "solid-js";
import { renderToStream, renderToString, renderToStringAsync } from "solid-js/web";
import { describe, expect, test } from "vitest";

class Point {
  constructor(
    readonly x: number,
    readonly y: number
  ) {}
}

class AdapterError extends Error {}

const pointPlugin = createPlugin<Point, { x: SerovalNode; y: SerovalNode }>({
  tag: "Point",
  test: (value): value is Point => value instanceof Point,
  parse: {
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

const errorPlugin = createPlugin<AdapterError, { message: SerovalNode }>({
  tag: "AdapterError",
  test: (value): value is AdapterError => value instanceof AdapterError,
  parse: {
    stream(value, ctx) {
      return { message: ctx.parse(value.message) };
    }
  },
  serialize(node, ctx) {
    return `new AdapterError(${ctx.serialize(node.message)})`;
  },
  deserialize(node, ctx) {
    return new AdapterError(ctx.deserialize(node.message));
  }
});

function captureScripts() {
  const scripts: Array<string> = [];
  return {
    scripts,
    transformSerializedScript(source: string) {
      const transformed = `pending.push(()=>{${source}})`;
      scripts.push(transformed);
      return transformed;
    }
  };
}

function createClient() {
  // The framework bootstrap must exist before any transformed source runs;
  // the custom deserializers can become ready later.
  return {
    $R: [],
    _$HY: { r: {} as Record<string, unknown> },
    pending: [] as Array<() => void>,
    Point: undefined as typeof Point | undefined,
    AdapterError: undefined as typeof AdapterError | undefined
  };
}

function runScripts(scripts: Array<string>, client: ReturnType<typeof createClient>) {
  for (const source of scripts) {
    runInNewContext(source, client);
  }
}

function collect(stream: ReturnType<typeof renderToStream>) {
  const records: Array<string> = [];
  let resolveFirst!: () => void;
  const first = new Promise<void>(resolve => (resolveFirst = resolve));
  const done = new Promise<string>(resolve => {
    stream.pipe({
      write(record: string) {
        records.push(record);
        resolveFirst();
      },
      end() {
        resolve(records.join(""));
      }
    });
  });
  return { first, done, records };
}

function resourceComponent(fetcher: () => Point | Promise<Point>) {
  return () => {
    const [point] = createResource(fetcher);
    return createComponent(Suspense, {
      fallback: "pending point",
      get children() {
        const value = point();
        return value ? `point=${value.x},${value.y}` : "";
      }
    });
  };
}

describe("serialized script transformation through Solid resources", () => {
  test("synchronous resources in the first stream record can wait for a deserializer", async () => {
    const capture = captureScripts();
    const options = { ...capture, plugins: [pointPlugin] };
    const output = collect(
      renderToStream(
        resourceComponent(() => new Point(5, 10)),
        options
      )
    );
    const html = await output.done;
    const client = createClient();

    expect(output.records[0]).toContain("pending.push");
    expect(html).toContain("point=5,10");
    expect(() => runScripts(capture.scripts, client)).not.toThrow();
    expect(Object.values(client._$HY.r)).toHaveLength(0);

    client.Point = Point;
    client.pending.forEach(run => run());

    expect(Object.values(client._$HY.r)).toContainEqual(new Point(5, 10));
  });

  test("resources resolving after the stream shell can wait for a deserializer", async () => {
    let resolvePoint!: (point: Point) => void;
    const point = new Promise<Point>(resolve => (resolvePoint = resolve));
    const capture = captureScripts();
    const options = { ...capture, plugins: [pointPlugin] };
    const output = collect(
      renderToStream(
        resourceComponent(() => point),
        options
      )
    );
    await output.first;
    expect(output.records[0]).toContain("pending point");
    resolvePoint(new Point(8, 12));
    const html = await output.done;
    const client = createClient();

    expect(html).toContain("point=8,12");
    expect(() => runScripts(capture.scripts, client)).not.toThrow();
    expect(Object.values(client._$HY.r)).toHaveLength(0);

    client.Point = Point;
    client.pending.forEach(run => run());

    const hydrated = await Promise.all(Object.values(client._$HY.r));
    expect(hydrated).toContainEqual(new Point(8, 12));
  });

  test("the async string renderer shares resource scheduling", async () => {
    const capture = captureScripts();
    const options = { ...capture, plugins: [pointPlugin] };
    const html = await renderToStringAsync(
      resourceComponent(() => Promise.resolve(new Point(3, 4))),
      options
    );
    const client = createClient();

    expect(html).toContain("point=3,4");
    expect(() => runScripts(capture.scripts, client)).not.toThrow();
    client.Point = Point;
    client.pending.forEach(run => run());

    const hydrated = await Promise.all(Object.values(client._$HY.r));
    expect(hydrated).toContainEqual(new Point(3, 4));
  });

  test("the synchronous string renderer transforms public error boundary data", () => {
    const capture = captureScripts();
    const options = { ...capture, plugins: [errorPlugin] };
    const html = renderToString(
      () =>
        createComponent(ErrorBoundary, {
          fallback: error => `caught ${error.message}`,
          get children(): string {
            throw new AdapterError("custom error");
          }
        }),
      options
    );
    const client = createClient();

    expect(html).toContain("caught custom error");
    expect(capture.scripts.length).toBeGreaterThan(0);
    expect(() => runScripts(capture.scripts, client)).not.toThrow();
    client.AdapterError = AdapterError;
    client.pending.forEach(run => run());

    expect(Object.values(client._$HY.r)).toContainEqual(new AdapterError("custom error"));
    expect(Object.values(client._$HY.r).some(error => error instanceof AdapterError)).toBe(true);
  });
});
