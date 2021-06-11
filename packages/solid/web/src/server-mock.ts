//@ts-nocheck
export type PipeToWritableResults = {
  startWriting: () => void;
  write: (v: string) => void;
  abort: () => void;
}

export function renderToString<T>(
  fn: () => T,
  options?: {
    eventNames?: string[];
    nonce?: string;
    noScript?: boolean;
  }
): string {}
export function renderToStringAsync<T>(
  fn: () => T,
  options?: {
    eventNames?: string[];
    timeoutMs?: number;
    nonce?: string;
    noScript?: boolean;
  }
): Promise<string> {}
export function pipeToNodeWritable<T>(
  fn: () => T,
  writable: { write: (v: string) => void },
  options?: {
    eventNames?: string[];
    nonce?: string;
    noScript?: boolean;
    onReady?: (r: PipeToWritableResults) => void;
    onComplete?: (r: PipeToWritableResults) => void | Promise<void>;
  }
): void {}
export function pipeToWritable<T>(
  fn: () => T,
  writable: WritableStream,
  options?: {
    eventNames?: string[];
    nonce?: string;
    noScript?: boolean;
    onReady?: (r: PipeToWritableResults) => void;
    onComplete?: (r: PipeToWritableResults) => void | Promise<void>;
  }
): void {}
export function ssr(template: string[] | string, ...nodes: any[]): { t: string } {}
export function resolveSSRNode(node: any): string {}
export function ssrClassList(value: { [k: string]: boolean }): string {}
export function ssrStyle(value: { [k: string]: string }): string {}
export function ssrSpread(accessor: any): () => string {}
export function ssrBoolean(key: string, value: boolean): string {}
export function escape(html: string): string {}
