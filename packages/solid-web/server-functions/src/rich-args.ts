// Bridge entry like ./client.ts: rollup bundles the runtime's rich-args
// module through this specifier. Its imports of the server-function client
// (config write) and shared wire layer (codec read, serializeString) are
// resolved to the EXTERNAL `@solidjs/web/server-functions/client` entry —
// the same built instance the compiled reference proxies call through — so
// `enableRichArguments()` writes the config the shared transport actually
// reads (see externalizeSharedClient in rollup.config.js). Importing this
// entry is the client's opt-in at the module-graph level: the serializer's
// write half ships only when this module does.
export * from "@dom-expressions/runtime/src/server-functions/rich-args.js";
