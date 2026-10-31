import { CandidateQueue, type Candidate } from "./selection.js";
import { chain } from "./fixtures.js";
import { runScenario } from "./runner.js";

test("later simpler examples replace early ones without confusing symptoms with bug identity", async () => {
  const result = await runScenario(chain("sync"));
  const candidate = (index: number, size: number, manual = false): Candidate => {
    const scenario = chain(manual ? "manual" : "sync");
    for (let i = 0; i < size; i++) scenario.turns.push({ steps: [{ op: "write", value: i }] });
    return {
      index,
      signature: "same symptom",
      scenario,
      pair: [],
      result: {
        ...result,
        scenario,
        status: "fail",
        failure: { rule: "S1", message: "fixture" }
      }
    };
  };
  const queue = new CandidateQueue(2);
  queue.offer(candidate(0, 10));
  queue.offer(candidate(1, 1));
  queue.offer(candidate(2, 20, true));
  expect(queue.entries.map(c => c.index)).toEqual([1, 2]);
  queue.offer(candidate(3, 0));
  expect(queue.entries.map(c => c.index)).toEqual([3, 2]);
  const other = candidate(4, 0);
  other.signature = "another symptom";
  queue.offer(other);
  expect(queue.entries.map(c => c.index)).toEqual([3, 4]);
});
