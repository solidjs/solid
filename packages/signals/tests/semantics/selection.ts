import { compareComplexity } from "./complexity.js";
import { isSemanticFailure } from "./admission.js";
import type { RunResult } from "./runner.js";
import type { Scenario } from "./scenario.js";

export interface Candidate {
  index: number;
  signature: string;
  scenario: Scenario;
  result: RunResult;
  pair: RunResult[];
}

// A scheduling heuristic, never a bug identity. Keep a little structural variety
// without keeping every graph (or its full trace) in memory.
function shape(s: Scenario): number {
  let bits = s.optimistic ? 1 : 0;
  if (s.actions?.length) bits |= 2;
  for (const n of s.nodes) {
    if (n.delivery === "manual") bits |= 4;
    else if (n.delivery !== "sync") bits |= 8;
    if (n.branch) bits |= 16;
  }
  for (const r of s.readers) {
    if (r.gated) bits |= 32;
    if (r.render) bits |= 64;
    if (r.pending) bits |= 128;
  }
  return bits;
}

function priority(c: Candidate): number {
  return isSemanticFailure(c.result) ? 0 : c.result.waiting || c.result.progress?.length ? 1 : 2;
}
function compare(a: Candidate, b: Candidate): number {
  return (
    priority(a) - priority(b) || compareComplexity(a.scenario, b.scenario) || a.index - b.index
  );
}

export class CandidateQueue {
  readonly entries: Candidate[] = [];
  constructor(readonly capacity = 8) {}
  offer(candidate: Candidate) {
    const entries = this.entries;
    let same = 0,
      worst = -1;
    const candidateShape = shape(candidate.scenario);
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].signature !== candidate.signature) continue;
      same++;
      worst = i; // Entries are sorted best first.
      if (shape(entries[i].scenario) === candidateShape) {
        if (compare(candidate, entries[i]) >= 0) return;
        entries[i] = candidate;
        entries.sort(compare);
        return;
      }
    }
    if (same >= 2) {
      if (compare(candidate, entries[worst]) >= 0) return;
      entries[worst] = candidate;
    } else entries.push(candidate);
    entries.sort(compare);
    if (entries.length > this.capacity) {
      // Reserve breadth before spending slots on a second shape of one symptom.
      for (let i = entries.length - 1; i > 0; i--)
        for (let j = 0; j < i; j++)
          if (entries[j].signature === entries[i].signature) {
            entries.splice(i, 1);
            return;
          }
      entries.pop();
    }
  }
}
