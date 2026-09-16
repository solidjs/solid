/**
 * Store visibility oracle runner — see visibility-oracle-store.states.ts for
 * the states.
 */
import { runOracle } from "./visibility-oracle.harness.js";
import { STATES } from "./visibility-oracle-store.states.js";
runOracle("visibility oracle — stores (A9, A17, A18, A19, A25, A29, A32, CS/OS rules)", STATES);
