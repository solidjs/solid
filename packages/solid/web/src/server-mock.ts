//@ts-nocheck
export function renderToString<T>(
  fn: () => T,
  options?: {
    nonce?: string;
    renderId?: string;
  }
): string {}
export function renderToStringAsync<T>(
  fn: () => T,
  options?: {
    timeoutMs?: number;
    nonce?: string;
    renderId?: string;
  }
): Promise<string> {}
export function renderToStream<T>(
  fn: () => T,
  options?: {
    nonce?: string;
    dataOnly?: boolean;
    renderId?: string;
    onCompleteShell?: () => void;
    onCompleteAll?: () => void;
  }
): {
  pipe: (writable: { write: (v: string) => void }) => void;
  pipeTo: (writable: WritableStream) => void;
} {}
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
    dataOnly?: boolean;
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
    dataOnly?: boolean;
    onReady?: (res: LegacyResults) => void;
    onCompleteAll?: () => void;
  }
): void;
