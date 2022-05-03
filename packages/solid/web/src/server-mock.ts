//@ts-nocheck
function throwInBrowser(func: Function) {
  const err = new Error(`${func.name} is not supported in the browser, returning undefined`);

  console.error(err);
}

export function renderToString<T>(
  fn: () => T,
  options?: {
    nonce?: string;
    renderId?: string;
  }
): string {
  throwInBrowser(renderToString);
}
export function renderToStringAsync<T>(
  fn: () => T,
  options?: {
    timeoutMs?: number;
    nonce?: string;
    renderId?: string;
  }
): Promise<string> {
  throwInBrowser(renderToStringAsync);
}
export function renderToStream<T>(
  fn: () => T,
  options?: {
    nonce?: string;
    renderId?: string;
    onCompleteShell?: (info: { write: (v: string) => void }) => void;
    onCompleteAll?: (info: { write: (v: string) => void }) => void;
  }
): {
  pipe: (writable: { write: (v: string) => void }) => void;
  pipeTo: (writable: WritableStream) => void;
} {
  throwInBrowser(renderToStream);
}
export function ssr(template: string[] | string, ...nodes: any[]): { t: string } {}
export function resolveSSRNode(node: any): string {}
export function ssrClassList(value: { [k: string]: boolean }): string {}
export function ssrStyle(value: { [k: string]: string }): string {}
export function ssrSpread(accessor: any): () => string {}
export function ssrBoolean(key: string, value: boolean): string {}
export function ssrHydrationKey(): string {}
export function escape(html: string): string {}
export function generateHydrationScript(): string {}

export type LegacyResults = {
  startWriting: () => void;
};
/**
 * @deprecated Replaced by renderToStream
 */
export function pipeToWritable<T>(
  fn: () => T,
  writable: WritableStream,
  options?: {
    nonce?: string;
    onReady?: (res: LegacyResults) => void;
    onCompleteAll?: () => void;
  }
): void;
/**
 * @deprecated Replaced by renderToStream
 */
export function pipeToNodeWritable<T>(
  fn: () => T,
  writable: { write: (v: string) => void },
  options?: {
    nonce?: string;
    onReady?: (res: LegacyResults) => void;
    onCompleteAll?: () => void;
  }
): void;
