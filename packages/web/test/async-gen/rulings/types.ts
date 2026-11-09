/**
 * Executable rulings (documentation/plans/optimism-seam-spike-brief.md §8;
 * packages/signals/docs/SCENARIOS.md). A ruling is a scenario in the async
 * generator's grammar plus the screen it must show after given steps and the
 * screens it rules out. `rulings.spec.ts` runs every case; the matching
 * `SCENARIOS.md` block is generated from the same object (`scenarios-md.ts`),
 * so the table the maintainer rules on and the test that pins it are one
 * thing.
 */
import type { Scenario } from "../scenario.js";
import type { Variant } from "../run.js";

/** The screen after step `after` (`screens[after + 1]`; `"render"` is the
 * first render, `screens[0]`). `"—"` means unchanged from the previous
 * frame. Raw `run.ts` serialization — the renderer translates it. */
export type Frame = { after: number | "render"; screen: string | "—"; note?: string };
/** A ✗ row: the screen after step `after` must not be this. */
export type Forbid = { after: number; screen: string; why: string };

export type Case = {
  /** Row suffix in the table: "" | "′" | "″" … */
  label?: string;
  scenario: Scenario;
  frames: Frame[];
  forbid?: Forbid[];
  /** Equivalence rewrites that must show the same screen at every frame. */
  variants?: Variant[];
  /** Law findings this case expects (a dev guard the scenario trips on
   * purpose); listed under the table. Any other finding fails. */
  allow?: string[];
  /** Overrides the ruling's status for this case. */
  status?: Ruling["status"];
  /** Under the table, for this case. */
  note?: string;
};

export type Ruling = {
  id: `S-${number}`;
  title: string;
  /** Rule ids the ruling is a row of: ["D-25", "F-6"]. */
  rules: string[];
  /** `standing`: the screens are today's and pinned. `ruled-not-built`: the
   * screens are ruled and the frames test is `it.fails` until the fix lands;
   * the generated block then also records today's screen. */
  status: "standing" | "ruled-not-built";
  issues?: string[];
  /** Hand-written tests that stay beside the ruling. */
  pins?: string[];
  /** Rendering names: `s0`, `m0` … → the name the doc uses; `L`/`F`/`E` →
   * fallback text. */
  names: Record<string, string>;
  cases: Case[];
  /** One paragraph under the table. */
  prose?: string;
};
