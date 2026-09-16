/**
 * Visibility oracle runner — see visibility-oracle.states.ts for the states
 * and the reader/cell vocabulary.
 */
import { runOracle } from "./visibility-oracle.harness.js";
import { STATES } from "./visibility-oracle.states.js";
runOracle("visibility oracle (A7, A15, A16, A17, A18, A19, A24, A26, A27, A29, A32)", STATES);
