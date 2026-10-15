// Acceptance: the chat streams a reply into stable blocks within a re-run
// budget, Stop closes the stream and keeps what arrived, and a failed reply
// is the boundary's fallback with a Retry that asks again.
//
// The server function runs in-process here (see vitest.config.ts), so the
// fake model streams straight into the projection: what is under test is
// the view and the projection, not the wire. The wire's contract — a client
// abort firing `request.signal` on the server — is the runtime's, exercised
// by its own suites; this example only forwards the signal.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush } from "solid-js";
import { render } from "@solidjs/web";
import {
  captureArtifact,
  expectNoDiagnostics,
  expectNoWaste,
  expectRerunBudget
} from "@solidjs/diagnostics";
import Chat from "~/chat";
import { splitBlocks } from "~/markdown";
import { ANSWER, FAILURE_WORD, PACE, tokens } from "~/server/model";

const CHUNKS = tokens(ANSWER).length;
const BLOCKS = splitBlocks(ANSWER).length;

// Text as the page shows it: markdown markers gone, whitespace collapsed.
const shown = (text: string) =>
  text
    .replace(/^```.*$/gm, "")
    .replace(/^- /gm, "")
    .replace(/\s+/g, " ")
    .trim();

// Wall-clock findings (hot scopes, a fallback shown "too briefly") measure
// the test's fake clock, not the app: off, as in the runtime's own suites.
const attribution = { hotTime: false, fallbackFlashes: false, wastedRecompute: false } as const;

let root: HTMLDivElement;
let dispose: () => void;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <Chat />, root);
});

afterEach(() => {
  dispose();
  root.remove();
  vi.useRealTimers();
});

function send(text: string) {
  root.querySelector("textarea")!.value = text;
  root
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  flush();
}

function click(selector: string) {
  const button = root.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`no ${selector} on screen`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flush();
}

/** Lets the model send `n` more tokens. */
async function stream(n: number) {
  for (let i = 0; i < n; i++) {
    await vi.advanceTimersByTimeAsync(PACE);
    flush();
  }
}

const reply = () => root.querySelector(".reply");
const replyText = () =>
  [...(reply()?.querySelectorAll(".md > *") ?? [])].map(el => el.textContent).join("\n");
const turns = () => [...root.querySelectorAll(".turns > .turn:not(.reply)")];

describe("chat-client", () => {
  it("streams a reply into stable blocks, one store write per chunk", async () => {
    let firstBlock: Element | null = null;
    const { artifact } = await captureArtifact(
      async () => {
        send("What is the pattern?");
        // Nothing has arrived: the reply is a boundary showing its fallback.
        expect(reply()!.textContent).toContain("Thinking");
        await stream(CHUNKS / 2);
        firstBlock = reply()!.querySelector(".md > *");
        await stream(CHUNKS / 2);
      },
      { scenario: "stream", attribution }
    );

    expect(shown(replyText())).toBe(shown(ANSWER));
    expect(reply()!.querySelectorAll(".md > *").length).toBe(BLOCKS);
    expect(reply()!.querySelector(".md > pre")).not.toBeNull();
    expect(reply()!.querySelectorAll(".md > .bullet").length).toBe(3);
    // The finished reply has no Stop; the question is the one user turn.
    expect(reply()!.querySelector(".stop")).toBeNull();
    expect(turns().map(t => t.className)).toEqual(["turn user"]);
    // A completed block keeps its element: later chunks never touched it.
    expect(reply()!.querySelector(".md > *")).toBe(firstBlock);

    expectNoDiagnostics(artifact);
    // Granularity: a chunk is one text update, in the last block. Across
    // every block of the reply, the text bindings re-ran at most once per
    // chunk — so the completed blocks' bindings never did.
    expectRerunBudget(artifact, CHUNKS, { scope: /\.children$/ });
    // The lists re-ran only when something was added to them — the reply's
    // once per block, the conversation's once for the question — never for
    // a chunk.
    expectRerunBudget(artifact, BLOCKS + 1, { scope: "<For>" });
    // And next to nothing re-ran to arrive at the value it already had. The
    // tolerated runs are known: the hole holding the reply's list re-runs
    // once per added block (the list's output is the same array), and the
    // code block's text re-runs once for the chunk that closes its fence,
    // which `unfence` strips.
    expectNoWaste(artifact, { maxWastedRuns: BLOCKS + 1 });
  });

  it("Stop closes the stream and keeps what arrived", async () => {
    const { artifact } = await captureArtifact(
      async () => {
        send("What is the pattern?");
        await stream(10);
        click(".reply .stop");
      },
      { scenario: "stop", attribution }
    );

    const kept = turns().at(-1)!;
    expect(kept.className).toBe("turn assistant");
    expect(kept.textContent).toContain("Stopped");
    const partial = kept.querySelector("p")!.textContent!;
    expect(partial).toBe(tokens(ANSWER).slice(0, 10).join(""));
    expect(reply()).toBeNull();

    // The model's pending token lands on a closed iterator, and nothing is
    // scheduled after it: the generator was closed through `return()`.
    await stream(1);
    expect(vi.getTimerCount()).toBe(0);
    await stream(5);
    expect(turns().at(-1)!.querySelector("p")!.textContent).toBe(partial);

    expectNoDiagnostics(artifact);
  });

  it("a new question supersedes the reply being written", async () => {
    send("What is the pattern?");
    await stream(6);
    send("And again?");
    expect(turns().map(t => t.className)).toEqual(["turn user", "turn assistant", "turn user"]);
    expect(turns()[1].textContent).toContain("Stopped");
    expect(reply()!.textContent).toContain("Thinking");
    await stream(3);
    expect(replyText()).toBe(tokens(ANSWER).slice(0, 3).join(""));
  });

  it("a failed reply is the boundary's fallback, and Retry asks again", async () => {
    const { artifact } = await captureArtifact(
      async () => {
        send(`Please ${FAILURE_WORD}`);
        await stream(14);
        expect(reply()!.textContent).toContain("The model stopped answering");
        click(".reply .error button");
        await stream(CHUNKS + 1);
      },
      { scenario: "retry", attribution }
    );
    expect(reply()!.querySelector(".error")).toBeNull();
    expect(reply()!.querySelectorAll(".md > *").length).toBe(BLOCKS);
    expectNoDiagnostics(artifact);
  });
});
