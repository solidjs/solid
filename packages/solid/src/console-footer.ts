// Point-of-pain discovery: the first console report of each diagnostic code
// gains a footer naming the repair skill shipped with this package, so a
// reader (human or agent) hitting the warning learns where the prescribed
// fix lives without any prior knowledge of the skill system.
//
// Perf/graph/responsiveness codes additionally name the attribution surface.
// This breaks a discovery circularity: the sensitive detectors (HUGE_FAN_OUT
// at the engine's threshold, HOT_SCOPE_*, ASYNC_WATERFALL, SILENT_HOLD, …) only fire while the
// `solid-js/attribution` engine is enabled, and a reader who doesn't know the
// entry exists never enables it — so the always-on graph warnings (and any such
// code that does fire) are the moments to teach that deeper evidence is one
// call away. Dev-tier: the footer is console text.
//
// Both pointers are given twice: the installed file (what an agent working in
// the repo can open with no network, at exactly the installed version) and a
// stable URL (what a human in a browser console can click; Chrome linkifies
// it) — the anchor jumps to the code's own section. The URL is the core's
// (`DEV.guideUrl`), so the footer and an observer's link (the performance
// tracks' Insights entry) name the same place.
//
// Installed by both entries — the client's and the server's — so a server
// render's console report (a `SERVER_WRITE`, a `HEAD_TAG_INVALID`) carries the
// same pointer as a client one. The skill has a section per code on either side.
// The registration is the core's `setConsoleFooter` seam, `@internal` to
// this package: signals cannot know this package's skill path, and nothing
// else has a footer to register.
import { DEV, setConsoleFooter } from "@solidjs/signals";

const SKILLS_URL = "https://github.com/solidjs/solid/blob/main/packages";

/** Dev-only; the callers gate on their build's dev literal, where `DEV` is defined. */
export function installConsoleFooter(): void {
  const guideUrl = DEV!.guideUrl;
  setConsoleFooter(event => {
    const base =
      `[${event.code}] repair guide: node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md ` +
      `— ${guideUrl(event.code)}`;
    return event.kind === "perf" || event.kind === "graph" || event.kind === "responsiveness"
      ? base +
          `\n[${event.code}] deeper evidence: import { attribution } from "solid-js/attribution"; ` +
          `attribution.enable() explains every re-run — why-chains, costs(), feedback(), ` +
          `history("hold" | "waterfall") — agent loop: ` +
          `node_modules/@solidjs/diagnostics/skills/agent-loops/SKILL.md — ` +
          `${SKILLS_URL}/diagnostics/skills/agent-loops/SKILL.md`
      : base;
  });
}
