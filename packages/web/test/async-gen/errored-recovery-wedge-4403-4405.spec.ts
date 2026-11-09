/**
 * @vitest-environment jsdom
 */
// #4403, #4405: the async-app generator's replays of a root `Errored` on its
// fallback after a sync memo threw, then an action that re-asks the memo —
// each wedged the scheduler ("Potential Infinite Loop Detected") and every
// later flush threw. The cases, in the variant that found them, that
// reproduce through `runScenario` on next @ f94dcd596 (the #4404 replays and
// the minimized #4403 one settle there); no finding, safety or liveness, is
// expected (D-39, D-41; D-3 for the remounts). The minimized shapes of all three issues in signals primitives,
// with the screens in between:
// `packages/signals/tests/errored-recovery-wedge-4403-4404-4405.test.ts`.
import { expect, test } from "vitest";
import { runScenario, type Variant } from "./run.js";
import type { Scenario } from "./scenario.js";

const cases: [string, Variant, string][] = [
  [
    "#4403 seed 3289 case 3963 (base)",
    {},
    `{"signals":[0],"memos":[{"async":false,"deps":[{"src":{"k":"s","i":0},"how":"plain"}],"poison":2},{"async":true,"deps":[{"src":{"k":"m","i":0},"how":"plain"}],"poison":null},{"async":true,"deps":[{"src":{"k":"s","i":0},"how":"plain"},{"src":{"k":"m","i":1},"how":"latest"}],"poison":2}],"tree":{"t":"show","when":{"how":"latest","src":{"k":"m","i":0}},"child":{"t":"group","kids":[{"t":"leaf","text":[],"attrs":[{"how":"pending","src":{"k":"m","i":1}},{"how":"plain","src":{"k":"s","i":0}}],"grouped":true},{"t":"leaf","text":[],"attrs":[{"how":"plain","src":{"k":"m","i":0}},{"how":"latest","src":{"k":"s","i":0}}],"grouped":true},{"t":"leaf","text":[],"attrs":[{"how":"plain","src":{"k":"s","i":0}}],"grouped":true}]},"fallback":true},"steps":[{"t":"settle","pick":2},{"t":"write","s":0,"v":0},{"t":"action","s":0,"v":2},{"t":"write","s":0,"v":1},{"t":"task"},{"t":"write","s":0,"v":1},{"t":"action","s":0,"v":0}]}`
  ],
  [
    "#4405 minimized (E8.b remount)",
    { remount: true },
    `{"signals":[2,3],"memos":[{"async":false,"deps":[{"src":{"k":"s","i":0},"how":"plain"},{"src":{"k":"s","i":1},"how":"latest"}],"poison":0},{"async":false,"deps":[{"src":{"k":"m","i":0},"how":"plain"},{"src":{"k":"s","i":1},"how":"plain"}],"poison":1}],"tree":{"t":"show","when":{"how":"plain","src":{"k":"m","i":1}},"child":{"t":"leaf","text":[],"attrs":[],"grouped":true},"fallback":false},"steps":[{"t":"action","s":1,"v":2},{"t":"settle","pick":2},{"t":"write","s":0,"v":3},{"t":"task"},{"t":"action","s":1,"v":1}]}`
  ],
  [
    "#4405 seed 7 case 1158 (E8.b remount)",
    { remount: true },
    `{"signals":[2,3],"memos":[{"async":false,"deps":[{"src":{"k":"s","i":0},"how":"plain"},{"src":{"k":"s","i":1},"how":"latest"}],"poison":0},{"async":false,"deps":[{"src":{"k":"m","i":0},"how":"plain"},{"src":{"k":"s","i":1},"how":"plain"}],"poison":1},{"async":false,"deps":[{"src":{"k":"m","i":1},"how":"plain"},{"src":{"k":"m","i":1},"how":"latest"}],"poison":null}],"tree":{"t":"group","kids":[{"t":"show","when":{"how":"latest","src":{"k":"m","i":1}},"child":{"t":"leaf","text":[],"attrs":[{"how":"plain","src":{"k":"m","i":0}}],"grouped":true},"fallback":false},{"t":"group","kids":[{"t":"group","kids":[{"t":"leaf","text":[{"how":"pending","src":{"k":"s","i":1}},{"how":"latest","src":{"k":"m","i":2}}],"attrs":[{"how":"plain","src":{"k":"m","i":2}}],"grouped":false}]},{"t":"errored","child":{"t":"leaf","text":[{"how":"pending","src":{"k":"s","i":1}},{"how":"latest","src":{"k":"m","i":2}}],"attrs":[],"grouped":true}},{"t":"leaf","text":[],"attrs":[{"how":"plain","src":{"k":"s","i":0}}],"grouped":false}]},{"t":"errored","child":{"t":"leaf","text":[{"how":"plain","src":{"k":"m","i":0}},{"how":"latest","src":{"k":"s","i":1}}],"attrs":[{"how":"pending","src":{"k":"m","i":0}},{"how":"pending","src":{"k":"m","i":2}}],"grouped":false}}]},"steps":[{"t":"write","s":1,"v":3},{"t":"action","s":1,"v":2},{"t":"settle","pick":2},{"t":"write","s":0,"v":3},{"t":"write","s":0,"v":0},{"t":"write","s":0,"v":3},{"t":"micro"},{"t":"task"},{"t":"flush"},{"t":"flush"},{"t":"action","s":1,"v":1}]}`
  ]
];

for (const [name, variant, json] of cases)
  test(name, { timeout: 30_000 }, async () => {
    const r = await runScenario(JSON.parse(json) as Scenario, variant);
    expect(r.findings).toEqual([]);
    expect(r.final).toBe(r.expected);
  });
