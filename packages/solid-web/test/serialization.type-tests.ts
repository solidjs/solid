// Compile-only guard for the serialization subpath's plugin-authoring
// surface: `createPlugin` and `OpaqueReference` must be importable from
// `@solidjs/web/serialization` — the version-pinned re-export (a plugin
// built against the author's own seroval dependency edge emits nodes the
// runtime's copy can't interpret; solid-start #1474) — and the authored
// plugin must be usable with every `plugins`/codec option the entry
// exposes. Runs under `test-types` against the built serialization types
// (`pnpm types` first).
import {
  createPlugin,
  createSerializer,
  OpaqueReference,
  resolveSerializerPlugins,
  serializeJSON,
  type SerializerPlugin,
  type SerovalNode
} from "@solidjs/web/serialization";

class Money {
  constructor(readonly cents: number) {}
}

// Authoring infers entirely through createPlugin's generics — no extra
// seroval context types needed in scope.
const MoneyPlugin = createPlugin<Money, { cents: SerovalNode }>({
  tag: "test/Money",
  test: value => value instanceof Money,
  parse: {
    sync: (value, ctx) => ({ cents: ctx.parse(value.cents) }),
    async: async (value, ctx) => ({ cents: await ctx.parse(value.cents) }),
    stream: (value, ctx) => ({ cents: ctx.parse(value.cents) })
  },
  serialize: (node, ctx) => `new Money(${ctx.serialize(node.cents)})`,
  deserialize: (node, ctx) => new Money(ctx.deserialize(node.cents) as number)
});

// The product is a SerializerPlugin, accepted by every plugins seam.
MoneyPlugin satisfies SerializerPlugin;
const plugins: SerializerPlugin[] = [MoneyPlugin];
resolveSerializerPlugins(plugins);
createSerializer({ globalIdentifier: "_$T", plugins, onData: () => {} });
serializeJSON(new Money(1), { plugins, onParse: () => {} });

// The generics hold end-to-end: deserialize produces Money, exactly.
declare const moneyNode: { cents: SerovalNode };
MoneyPlugin.deserialize(moneyNode, null as never, null as never) satisfies Money;
// @ts-expect-error the deserialized product is Money, not Date
MoneyPlugin.deserialize(moneyNode, null as never, null as never) satisfies Date;

// OpaqueReference constructs and carries its generics through the same
// pinned instance.
const opaque = new OpaqueReference(new Money(1), "redacted");
opaque.value satisfies Money;
opaque.replacement satisfies string | undefined;
