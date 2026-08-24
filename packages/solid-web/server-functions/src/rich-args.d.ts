/**
 * Opt-in codec encoding for server-function ARGUMENTS. By default the client
 * sends argument lists as plain JSON (no serializer in the bundle) and
 * throws on values JSON can't carry faithfully. Call once at startup to
 * send Dates, Maps, Sets, typed arrays, cyclic structures, etc. through the
 * codec — at the cost of the serializer's write half (~5 KB gz on top of
 * the decode half responses already need). The handler accepts both
 * encodings unconditionally.
 */
export function enableRichArguments(): void;
