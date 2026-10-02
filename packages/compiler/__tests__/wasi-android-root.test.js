"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

// The WASI binding only exists after a wasm32-wasip1-threads build, which
// the WASI test run (SOLID_COMPILER_TEST_WASI) has.
const describeWasi = process.env.SOLID_COMPILER_TEST_WASI ? describe : describe.skip;

const compilerDir = path.resolve(__dirname, "..");
const shim = path.join(__dirname, "wasi-android", "simulate-termux.cjs");
const script = `
  const compiler = require(${JSON.stringify(compilerDir)});
  const sync = compiler.transform("const el = <div class='a' />;", { filename: "a.jsx" }).code;
  compiler
    .transformAsync("const el = <span />;", { filename: "b.jsx" })
    .then(async => console.log(JSON.stringify({ sync, async: async.code })));
`;

function loadUnderTermux(simulateAndroid) {
  return spawnSync(process.execPath, ["--require", shim, "-e", script], {
    cwd: compilerDir,
    encoding: "utf8",
    env: {
      ...process.env,
      NAPI_RS_FORCE_WASI: "error",
      SIMULATE_ANDROID: simulateAndroid ? "1" : "0"
    },
    timeout: 60_000
  });
}

describeWasi("WASI binding where the filesystem root is not accessible (#3748)", () => {
  test("the simulation rejects a preopen of the host root", () => {
    const result = loadUnderTermux(false);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("UVWASI_EACCES");
  });

  test("loads and compiles on Android without preopening the host root", () => {
    const result = loadUnderTermux(true);
    expect(result.stderr).not.toContain("UVWASI_EACCES");
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout.trim().split("\n").pop());
    expect(out.sync).toContain("_$template");
    expect(out.async).toContain("_$template");
  });
});
