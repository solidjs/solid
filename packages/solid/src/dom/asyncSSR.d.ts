export function renderToString<T>(
  fn: () => T,
  options?: {
    timeoutMs?: number;
  }
): T extends Promise<any> ? Promise<string> : string;

export function renderDOMToString<T>(
  fn: () => T,
  options?: {
    timeoutMs?: number;
  }
): T extends Promise<any> ? Promise<string> : string;

export function ssr(
  template: string[] | string,
  ...nodes: any[]
): { t: string | (() => string) };
