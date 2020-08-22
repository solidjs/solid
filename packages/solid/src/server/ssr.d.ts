export function renderToString<T>(fn: () => T): string;
export function renderToNodeStream<T>(fn: () => T): ReadableStream<string>;
export function ssr(template: string[] | string, ...nodes: any[]): { t: string };
export function resolveSSRNode(node: any): string;
