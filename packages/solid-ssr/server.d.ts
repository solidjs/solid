export default function createServer(options: {
  path: string;
  forks: number;
  maxRAM: number;
  args: [];
  requestLimit: number;
}): (req: any) => Promise<string>;
