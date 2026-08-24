export interface ServerFunction<A extends readonly any[] = any, T = any> {
  (...args: A): Promise<T>;
  readonly id: string;
  readonly url: string;
}

export interface ServerFunctionMetadata {
  readonly method?: "GET" | "POST";
  readonly name?: string;
  readonly [key: string]: unknown;
}

export interface ServerFunctionRPC {
  GET<A extends readonly any[], R>(fn: (...args: A) => R): ServerFunction<A, Awaited<R>>;
  decodeResponse<T = unknown>(response: Response): Promise<T | undefined>;
}

export const SERVER_FUNCTION_METADATA = Symbol.for("solid.ServerFunctionMetadata");
export const LIVE_SOURCE = Symbol.for("solid.LiveSource");

export function getServerFunctionMetadata(fn: unknown): ServerFunctionMetadata | undefined {
  if (typeof fn !== "function") return undefined;
  return (fn as any)[SERVER_FUNCTION_METADATA] || undefined;
}

export function isServerFunction(fn: unknown): fn is ServerFunction {
  return typeof fn === "function" && !!(fn as any)[SERVER_FUNCTION_METADATA];
}

export function withMeta<F extends (...args: any[]) => any>(
  fn: F,
  meta: ServerFunctionMetadata
): F {
  const metadata = getServerFunctionMetadata(fn);
  if (!metadata) throw new Error("withMeta expects a server function reference");
  Object.assign(metadata, meta);
  return fn;
}

const SERVER_FUNCTION_RPC = Symbol.for("solid.ServerFunctionRPC");

export function provideServerFunctionRPC(rpc: ServerFunctionRPC): void {
  (globalThis as any)[SERVER_FUNCTION_RPC] ||= rpc;
}

export function getServerFunctionRPC(): ServerFunctionRPC | undefined {
  return (globalThis as any)[SERVER_FUNCTION_RPC];
}
