import {
  parseCookieHeader as parse,
  serializeCookie as serialize
} from "@dom-expressions/runtime/src/cookies.js";

export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | "Lax" | "Strict" | "None";
}

export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  return parse(header);
}

export function serializeCookie(name: string, value: string, options?: CookieOptions): string {
  return serialize(name, value, options);
}

export const FLASH_COOKIE = "flash";

const FLASH_MATCHER = new RegExp(`(?:^|;\\s*)${FLASH_COOKIE}=([^;]+)`);

export function hasFlashCookie(cookieHeader: string | null): boolean {
  return !!cookieHeader && FLASH_MATCHER.test(cookieHeader);
}

export function matchFlashCookie(cookieHeader: string | null): string | undefined {
  const match = cookieHeader && cookieHeader.match(FLASH_MATCHER);
  return match ? match[1] : undefined;
}

export function clearFlashCookie(): string {
  return `${FLASH_COOKIE}=; Max-Age=0; Path=/`;
}
