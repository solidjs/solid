/**
 * A committed mutation must report itself, whatever its value LOOKS like.
 *
 * The whole reason the flash cookie degrades instead of vanishing (#3137,
 * pinned by server-functions-flash-bounds.spec.tsx) is that a missing
 * confirmation reads as "nothing happened", and the natural response to
 * that is to submit again — which for a non-idempotent handler is the
 * second write. The ladder states the invariant in flash.ts itself: "`url`
 * and the error/thrown flags always survive: what happened, and to which
 * submission, is the part that must not be lost."
 *
 * Two truthiness tests sit on that road and lose the outcome for free:
 *
 *   - flash.ts, decode: `if (!payload || !payload.result) return;` — a
 *     WELL-FORMED cookie whose result is falsy is discarded. The encoder
 *     wrote it, the browser stored it, the render decodes nothing. `""` is
 *     an ordinary return (a form that saves and answers with an empty
 *     message), `false` and `0` are ordinary answers, and a thrown
 *     `Error("")` loses the ERROR flag too — the one thing the ladder above
 *     promises always survives.
 *   - server.ts, `createNoJSHandler`: `if (result && !(result instanceof
 *     Response))` — a function that simply returns emits no cookie at all,
 *     so the most ordinary action of the lot (`async () => { await
 *     db.save(...) }`) is exactly the one whose commit is invisible.
 *
 * The scripted leg has no such gap: a call returning `undefined` resolves
 * and the submission reports success. The no-JS leg is meant to show the
 * outcome "exactly as it would for a scripted call" (flash.ts header).
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { describe, expect, it } from "vitest";
import {
  FLASH_COOKIE,
  createNoJSHandler,
  decodeFlashCookie,
  encodeFlashCookie
} from "@solidjs/web/server-functions/server";

/** What the browser stores: the name=value pair, before the attributes. */
function pairOf(setCookie: string) {
  const end = setCookie.indexOf("; ");
  return end < 0 ? setCookie : setCookie.slice(0, end);
}

function roundTrip(setCookie: string) {
  return decodeFlashCookie(pairOf(setCookie));
}

/** A browser form post, as the no-JS leg receives it. */
function formPost() {
  return new Request("https://app.example/_server/save-draft", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://app.example/drafts/9"
    },
    body: "body=hello"
  });
}

describe("a falsy result is still an outcome", () => {
  it("delivers an empty-string result rather than discarding the cookie", () => {
    const cookie = encodeFlashCookie("/_server/save-draft", "", ["hello"]);
    const submission = roundTrip(cookie);

    // the control: absence really is absence, and stays undefined
    expect(decodeFlashCookie(null)).toBeUndefined();

    expect(submission).toBeDefined();
    expect(submission?.url).toBe("/_server/save-draft");
    expect(submission?.result).toBe("");
  });

  it("delivers 0, false and null the same way", () => {
    for (const result of [0, false, null]) {
      const submission = roundTrip(encodeFlashCookie("/_server/vote", result, []));
      expect(submission, `result ${JSON.stringify(result)} was discarded`).toBeDefined();
      expect(submission?.url).toBe("/_server/vote");
      expect(submission?.result).toBe(result);
    }
  });

  it("keeps the error flag on a thrown outcome whose message is empty", () => {
    // the flag, not the text, is what the next render branches on: losing it
    // turns a failed charge into a page that looks like nothing was posted
    const cookie = encodeFlashCookie("/_server/charge", new Error(""), [], true);
    const submission = roundTrip(cookie);

    expect(submission).toBeDefined();
    expect(submission?.error).toBeInstanceOf(Error);
    expect((submission?.error as Error).message).toBe("");
    expect(submission?.result).toBeUndefined();
  });

  it("flashes that the submission happened when the function simply returns", () => {
    // `async () => { await db.save(draft); }` — the commonest action shape
    // there is, and the one with no value to be truthy
    const response = createNoJSHandler()(undefined, formPost(), ["hello"]);

    expect(response.status).toBe(303);
    const flash = response.headers
      .getSetCookie()
      .find(entry => entry.startsWith(`${FLASH_COOKIE}=`));
    expect(
      flash,
      "no outcome cookie at all — the next render cannot tell it committed"
    ).toBeDefined();

    const submission = roundTrip(flash!);
    expect(submission?.url).toBe("/_server/save-draft");
    expect(submission?.input).toEqual(["hello"]);
  });
});
