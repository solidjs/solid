// forward declarations
declare namespace NodeJS {
  interface ReadableStream {}
}

export function renderToString<T>(fn: () => T): string;
export function renderToNodeStream<T>(fn: () => T): NodeJS.ReadableStream;
export function renderToWebStream<T>(fn: () => T): ReadableStream;
export function ssr(template: string[] | string, ...nodes: any[]): { t: string };
export function resolveSSRNode(node: any): string;
export function ssrClassList(value: { [k: string]: boolean }): string;
export function ssrStyle(value: { [k: string]: string }): string;
export function ssrSpread(accessor: any): () => string;
export function ssrBoolean(key: string, value: boolean): string;
export function escape(html: string): string;
export function generateHydrationScript(options?: { eventNames?: string[], streaming?: boolean }): string;
export function getHydrationKey(): string;
export function effect<T>(fn: (prev?: T) => T, init?: T): void;
export function memo<T>(fn: () => T, equal: boolean): () => T;
export function createComponent<T>(Comp: (props: T) => JSX.Element, props: T): JSX.Element;
export function dynamicProperty(props: unknown, key: string): unknown;
export function assignProps(target: unknown, ...sources: unknown[]): unknown;
export function currentContext(): unknown;
