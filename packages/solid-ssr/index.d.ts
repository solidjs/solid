export function client(
  code: (req: { path: any; url: any; headers: any }) => Promise<string>
): Promise<string>;
