/**
 * THE FLASH KEY IS STRETCHED, NOT JUST HASHED.
 *
 * `secret` accepts any non-empty string, so a deployment can hand the runtime
 * a short human-chosen value. A captured cookie is an offline oracle for that
 * value: guess a secret, derive the key, try to decrypt. Under a bare digest
 * each guess costs one hash, so a guessable secret falls quickly, and
 * recovering it means reading every flash payload (the submitted form input,
 * passwords included) and forging new ones.
 *
 * Derivation is PBKDF2-HMAC-SHA-256 over the secret, salted with the domain
 * string, so each guess costs the iteration count instead. That does not make
 * a weak secret safe. It raises the price, and the `secret` option documents
 * the entropy requirement.
 *
 * These tests pin the derivation by attacking the cookie the public API
 * produces: the bare digest must NOT open it, and PBKDF2 with the documented
 * parameters must. Weaken either half and one of them fails.
 *
 * Like the other server-function specs, these run against the built bundles.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  FLASH_COOKIE,
  decodeFlashCookie,
  encodeFlashCookie
} from "@solidjs/web/server-functions/server";

// Must match the runtime's own constants. They are deliberately duplicated
// here: a test that imported them could not catch a change to them.
const FLASH_KEY_DOMAIN = "solid.flash.v1\0";
const FLASH_KEY_ITERATIONS = 100_000;
const IV_BYTES = 12;

const SECRET = "spec-deployment-key";

function withKey(key = SECRET) {
  (globalThis as any).__SOLID_SECRET__ = key;
}

afterEach(() => {
  delete (globalThis as any).__SOLID_SECRET__;
});

// The wire value out of a Set-Cookie, minus the `1.` format version.
function packedOf(setCookie: string | null) {
  expect(setCookie).not.toBeNull();
  const end = setCookie!.indexOf("; ");
  const pair = end < 0 ? setCookie! : setCookie!.slice(0, end);
  const value = pair.slice(FLASH_COOKIE.length + 1);
  expect(value.startsWith("1.")).toBe(true);
  const binary = atob(value.slice(2).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// What the derivation used to be: one SHA-256 over domain + secret.
async function bareDigestKey(secret: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(FLASH_KEY_DOMAIN + secret)
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
}

// What it is now.
async function stretchedKey(secret: string, iterations = FLASH_KEY_ITERATIONS) {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, [
    "deriveKey"
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(FLASH_KEY_DOMAIN),
      iterations,
      hash: "SHA-256"
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function opens(packed: Uint8Array, key: CryptoKey) {
  try {
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: packed.subarray(0, IV_BYTES) },
      key,
      packed.subarray(IV_BYTES)
    );
    return true;
  } catch {
    return false;
  }
}

describe("the flash key is stretched from the deployment secret", () => {
  it("does not open under a bare digest of the secret", async () => {
    withKey();
    const packed = packedOf(await encodeFlashCookie("/login", { ok: true }, []));
    expect(await opens(packed, await bareDigestKey(SECRET))).toBe(false);
  });

  it("opens under PBKDF2 with the documented parameters", async () => {
    withKey();
    const packed = packedOf(await encodeFlashCookie("/login", { ok: true }, []));
    expect(await opens(packed, await stretchedKey(SECRET))).toBe(true);
  });

  it("is bound to the iteration count", async () => {
    withKey();
    const packed = packedOf(await encodeFlashCookie("/login", { ok: true }, []));
    // A cheaper derivation is a different key. Lowering the count silently
    // would be the whole bug back again.
    expect(await opens(packed, await stretchedKey(SECRET, 1_000))).toBe(false);
  });

  it("is bound to the domain salt, so another purpose's key cannot read it", async () => {
    withKey();
    const packed = packedOf(await encodeFlashCookie("/login", { ok: true }, []));
    const encoder = new TextEncoder();
    const material = await crypto.subtle.importKey("raw", encoder.encode(SECRET), "PBKDF2", false, [
      "deriveKey"
    ]);
    const otherPurpose = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: encoder.encode("solid.other.v1\0"),
        iterations: FLASH_KEY_ITERATIONS,
        hash: "SHA-256"
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    expect(await opens(packed, otherPurpose)).toBe(false);
  });

  it("still round-trips a submission through the public API", async () => {
    withKey();
    const form = new FormData();
    form.set("user", "ada@example.com");
    const cookie = await encodeFlashCookie("/login", { receipt: "RCPT-1" }, [form]);
    const end = cookie!.indexOf("; ");
    const submission = (await decodeFlashCookie(end < 0 ? cookie! : cookie!.slice(0, end)))!;
    expect(submission.url).toBe("/login");
    expect(submission.result).toEqual({ receipt: "RCPT-1" });
    expect((submission.input[0] as FormData).get("user")).toBe("ada@example.com");
  });
});
