// Opt-in codec encoding for server-function ARGUMENTS. By default the
// client sends argument lists as plain JSON (the fast path — no serializer
// in the bundle) and throws on values JSON can't carry faithfully. Importing
// this entry and calling `enableRichArguments()` once at startup installs
// the codec for those calls — Dates, Maps, Sets, typed arrays, cyclic
// structures. The codec itself is late-loaded by the shared wire layer
// (shared.js loadSerializer) on the first rich value in either direction,
// so enabling rich arguments costs nothing until such a value is actually
// sent; responses negotiate independently — the server answers JSON-safe
// results as plain JSON and only rich results wake the decode half.
import { getServerFunctionsCodec, serializeString } from "./shared.js";
import { configureServerFunctionsClient } from "./client.js";

export function enableRichArguments() {
  configureServerFunctionsClient({
    serializeArgs: args => serializeString(args, getServerFunctionsCodec())
  });
}
