// forward declarations
declare namespace NodeJS {
  interface ReadableStream {}
}

export function renderToString<T>(fn: () => T): string;
export function renderToNodeStream<T>(fn: () => T): NodeJS.ReadableStream;
export function ssr(template: string[] | string, ...nodes: any[]): { t: string };
export function resolveSSRNode(node: any): string;
