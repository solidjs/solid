//@ts-nocheck
type RenderToStringResults = {
  html: string;
  script: string;
};

export function renderToString<T>(
  fn: () => T,
  options?: {
    eventNames?: string[];
  }
): RenderToStringResults {}
export function renderToStringAsync<T>(
  fn: () => T,
  options?: {
    eventNames?: string[];
    timeoutMs?: number;
  }
): Promise<RenderToStringResults> {}
export function renderToNodeStream<T>(
  fn: () => T,
  options?: {
    eventNames?: string[];
  }
): {
  stream: NodeJS.ReadableStream;
  script: string;
} {}

export function renderToWebStream<T>(
  fn: () => T,
  options?: {
    eventNames?: string[];
  }
): {
  writeTo: (writer: WritableStreamDefaultWriter) => Promise<void>;
  script: string;
} {}
export function ssr(template: string[] | string, ...nodes: any[]): { t: string } {}
export function resolveSSRNode(node: any): string {}
export function ssrClassList(value: { [k: string]: boolean }): string {}
export function ssrStyle(value: { [k: string]: string }): string {}
export function ssrSpread(accessor: any): () => string {}
export function ssrBoolean(key: string, value: boolean): string {}
export function escape(html: string): string {}
