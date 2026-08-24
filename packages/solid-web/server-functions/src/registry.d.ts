// Types for the codec-free universal layer (registry.js): the
// declaration-metadata channel and the late-bound RPC seam. The
// declarations themselves live in shared.d.ts — the one server-functions
// d.ts every published-types layout ships — so consumers resolving either
// module see a single set of documented types; this file just points deep
// imports of registry.js at them.
export {
  SERVER_FUNCTION_METADATA,
  getServerFunctionMetadata,
  getServerFunctionRPC,
  isServerFunction,
  provideServerFunctionRPC,
  withMeta
} from "./shared.js";
export type { ServerFunction, ServerFunctionMetadata, ServerFunctionRPC } from "./shared.js";
