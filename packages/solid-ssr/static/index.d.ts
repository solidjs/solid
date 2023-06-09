export type StaticConfig = { entry: string, output: string, url: string }
export default function renderStatic(config: StaticConfig | StaticConfig[]): Promise<void>;