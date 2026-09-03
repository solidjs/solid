/**
 * THE FLASH COOKIE IS CIPHERTEXT (#3239).
 *
 * The flash carries the submitted form input — whatever the user typed,
 * passwords included — so a plaintext cookie leaves that readable in proxy
 * logs, in the jar at rest, and on every request it rides until cleared.
 * Both codec halves run only on the server (the browser just stores and
 * returns the value), so the cookie is an opaque server-to-server channel:
 * the payload is AES-GCM encrypted under a key derived from a
 * deployment-wide secret.
 *
 * The key resolves in order: `configureServerFunctionsServer({ secret })`,
 * then `globalThis.__SOLID_SECRET__` (the internal contract the Solid
 * bundler plugin fills with a per-build random key), then nothing — and
 * with nothing the flash is WITHHELD, never sent in the clear: the no-JS
 * post still redirects, only the outcome echo is missing.
 *
 * Decryption failure reads as "no flash": a tampered value, a foreign key,
 * a rotated deployment — none of them may take down the render, and the
 * one-shot clear disposes of the cookie either way.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  FLASH_COOKIE,
  configureServerFunctionsServer,
  decodeFlashCookie,
  encodeFlashCookie
} from "@solidjs/web/server-functions/server";

function pairOf(setCookie: string | null) {
  expect(setCookie).not.toBeNull();
  const end = setCookie!.indexOf("; ");
  return end < 0 ? setCookie! : setCookie!.slice(0, end);
}

function valueOf(setCookie: string | null) {
  return pairOf(setCookie).slice(FLASH_COOKIE.length + 1);
}

// The submission every test encodes: a login form, the worst case the
// cookie can carry.
function loginForm() {
  const form = new FormData();
  form.set("user", "ada@example.com");
  form.set("password", "hunter2-correct-horse");
  return form;
}

afterEach(() => {
  delete (globalThis as any).__SOLID_SECRET__;
});

// NOTE: order matters within this file. The no-key describe runs first
// (before any key exists), and the configured-secret describe runs LAST —
// `configureServerFunctionsServer({ secret })` has no public unset, so once
// the option is exercised the global-key tests would no longer be testing
// the global.

describe("without a key there is no flash — withheld, never plaintext", () => {
  it("the encoder returns null rather than an unencrypted cookie", async () => {
    expect(await encodeFlashCookie("/login", new Error("wrong password"), [loginForm()], true)) //
      .toBeNull();
  });

  it("the decoder reads any leftover cookie as no flash", async () => {
    expect(await decodeFlashCookie(`${FLASH_COOKIE}=1.AAAAAAAAAAAAAAAAAAAAAAAAAAAA`)) //
      .toBeUndefined();
  });
});

describe("under the bundler-injected key the value is opaque", () => {
  function withKey(key = "spec-deployment-key") {
    (globalThis as any).__SOLID_SECRET__ = key;
  }

  it("never carries the submitted input or the outcome in the clear", async () => {
    withKey();
    const cookie = await encodeFlashCookie(
      "/login",
      new Error("wrong password"),
      [loginForm()],
      true
    );
    const value = valueOf(cookie);

    // versioned wire format: `1.` then base64url — no JSON in sight
    expect(value.startsWith("1.")).toBe(true);
    expect(value.slice(2)).toMatch(/^[A-Za-z0-9_-]+$/);
    // neither the password nor any recognizable payload structure
    const exposed = value + decodeURIComponent(value);
    expect(exposed).not.toContain("hunter2");
    expect(exposed).not.toContain("password");
    expect(exposed).not.toContain("wrong password");
    expect(exposed).not.toContain('"url"');
  });

  it("round-trips the submission through the key", async () => {
    withKey();
    const cookie = await encodeFlashCookie(
      "/login",
      new Error("wrong password"),
      [loginForm()],
      true
    );
    const submission = (await decodeFlashCookie(pairOf(cookie)))!;

    expect(submission.url).toBe("/login");
    expect(submission.error).toBeInstanceOf(Error);
    expect((submission.error as Error).message).toBe("wrong password");
    expect((submission.input[0] as FormData).get("password")).toBe("hunter2-correct-horse");
  });

  it("two encodes of one outcome never repeat a value (fresh IV each)", async () => {
    withKey();
    const first = valueOf(await encodeFlashCookie("/login", { ok: true }, []));
    const second = valueOf(await encodeFlashCookie("/login", { ok: true }, []));
    expect(first).not.toBe(second);
  });

  it("reads a tampered value as no flash, not as an error", async () => {
    withKey();
    const pair = pairOf(await encodeFlashCookie("/login", { ok: true }, [loginForm()]));
    // flip one character deep in the ciphertext
    const at = pair.length - 10;
    const flipped = pair[at] === "A" ? "B" : "A";
    const tampered = pair.slice(0, at) + flipped + pair.slice(at + 1);

    expect(await decodeFlashCookie(tampered)).toBeUndefined();
  });

  it("reads another deployment's cookie as no flash (key rotation)", async () => {
    withKey("deployment-key-v1");
    const pair = pairOf(await encodeFlashCookie("/login", { ok: true }, []));

    withKey("deployment-key-v2");
    expect(await decodeFlashCookie(pair)).toBeUndefined();
  });

  it("wears the one-shot envelope: Secure, HttpOnly, SameSite=Lax, Max-Age", async () => {
    withKey();
    const cookie = (await encodeFlashCookie("/login", { ok: true }, []))!;

    expect(cookie).toContain("; Secure");
    expect(cookie).toContain("; HttpOnly");
    expect(cookie).toContain("; SameSite=Lax");
    expect(cookie).toContain("; Max-Age=60");
  });
});

describe("the configured secret outranks the global", () => {
  it("a cookie encrypted under the option survives the global's removal", async () => {
    (globalThis as any).__SOLID_SECRET__ = "the-global-key";
    configureServerFunctionsServer({ secret: "the-configured-secret" });
    const pair = pairOf(await encodeFlashCookie("/login", { ok: true }, []));

    // had the encode used the global, this decode would now fail
    delete (globalThis as any).__SOLID_SECRET__;
    expect((await decodeFlashCookie(pair))?.result).toEqual({ ok: true });
  });
});
