/**
 * Types for `generate-diagnostics-json.mjs`, for the agreement test in
 * `packages/solid/test/diagnostics-catalog.spec.ts`.
 */
export const DEV_TS: string;
export const RFC_MD: string;
export const SKILL_MD: string;
export const OUTPUT_JSON: string;
export const GUIDE_BASE_URL: string;

export interface DevUnions {
  codes: string[];
  kinds: string[];
  severities: string[];
}

export interface RfcRow {
  severity: string;
  category: string;
  trigger: string;
}

export interface CatalogSources {
  dev: DevUnions;
  rfc: Map<string, RfcRow>;
  /** code → first sentence of its section (null when the section is empty). */
  skill: Map<string, string | null>;
}

export interface CatalogEntry {
  code: string;
  kind: string[];
  severity: string[];
  category: string;
  trigger: string;
  repair: string | null;
  guideUrl: string;
}

export function repoRoot(): string;
export function parseDevTs(source: string, file?: string): DevUnions;
export function parseRfcTable(source: string, file?: string): Map<string, RfcRow>;
export function parseSkillSections(source: string, file?: string): Map<string, string | null>;
export function guideUrl(code: string): string;
export function readSources(root?: string): CatalogSources;
export function buildCatalog(sources: CatalogSources): CatalogEntry[];
export function serializeCatalog(catalog: CatalogEntry[]): string;
