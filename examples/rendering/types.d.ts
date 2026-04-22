declare module "virtual:asset-manifest" {
  interface AssetManifestEntry {
    file: string;
    isEntry?: boolean;
    isDynamicEntry?: boolean;
    imports?: string[];
  }

  const manifest: Record<string, AssetManifestEntry>;
  export default manifest;
}
