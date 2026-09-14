// Point-of-pain discovery: the first console report of each diagnostic code
// gains a footer naming the repair skill shipped with this package, so a
// reader (human or agent) hitting the warning learns where the prescribed
// fix lives without any prior knowledge of the skill system.
//
// Perf/graph/responsiveness codes additionally name the attribution surface.
// This breaks a discovery circularity: the sensitive detectors (WIDE_WRITE,
// HOT_SCOPE_*, ASYNC_WATERFALL, SILENT_HOLD, …) only fire while the
// `solid-js/attribution` engine is enabled, and a reader who doesn't know the
// entry exists never enables it — so the always-on graph warnings (and any such
// code that does fire) are the moments to teach that deeper evidence is one
// call away. Dev-tier: the footer is console text.
//
// Both pointers are given twice: the installed file (what an agent working in
// the repo can open with no network, at exactly the installed version) and a
// stable URL (what a human in a browser console can click; Chrome linkifies
// it) — the anchor jumps to the code's own section.
//
// Installed by both entries — the client's and the server's — so a server
// render's console report (a `SERVER_WRITE`, a `HEAD_TAG_INVALID`) carries the
// same pointer as a client one. The skill has a section per code on either side.
import type { Dev } from "@solidjs/signals";

const SKILLS_URL = "https://github.com/solidjs/solid/blob/main/packages";

export function installConsoleFooter(dev: Dev): void {
  dev.setConsoleFooter(event => {
    // GitHub heading anchors: lowercased, underscores kept (`### SILENT_HOLD` → `#silent_hold`).
    const anchor = event.code.toLowerCase();
    const base =
      `[${event.code}] repair guide: node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md ` +
      `— ${SKILLS_URL}/solid/skills/reactivity-diagnostics/SKILL.md#${anchor}`;
    return event.kind === "perf" || event.kind === "graph" || event.kind === "responsiveness"
      ? base +
          `\n[${event.code}] deeper evidence: import { attribution } from "solid-js/attribution"; ` +
          `attribution.enable() explains every re-run — why-chains, costs(), waterfalls(), ` +
          `holds(), feedback() — agent loop: ` +
          `node_modules/@solidjs/diagnostics/skills/agent-loops/SKILL.md — ` +
          `${SKILLS_URL}/diagnostics/skills/agent-loops/SKILL.md`
      : base;
  });
}
