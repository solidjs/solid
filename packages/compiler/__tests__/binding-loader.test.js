"use strict";

const fs = require("fs");
const Module = require("module");

describe("binding loader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(require.cache)) {
      if (key.includes(`${pathSep}packages${pathSep}compiler${pathSep}`)) {
        delete require.cache[key];
      }
    }
  });

  const pathSep = require("path").sep;

  test("falls back to WASI when native addons cannot load", () => {
    const forceWasi = process.env.NAPI_RS_FORCE_WASI;
    delete process.env.NAPI_RS_FORCE_WASI;
    const existsSync = fs.existsSync;
    vi.spyOn(fs, "existsSync").mockImplementation(file => {
      const filename = String(file);
      return !filename.endsWith(".node") && !filename.endsWith(".wasi.cjs") && existsSync(file);
    });

    const nativePackages =
      process.platform === "darwin"
        ? [`@solidjs/compiler-darwin-${process.arch}`]
        : process.platform === "linux"
          ? [`@solidjs/compiler-linux-${process.arch}-gnu`]
          : ["@solidjs/compiler-win32-x64-msvc"];

    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (nativePackages.includes(request)) {
        throw new Error("Cannot load native addon because loading addons is disabled");
      }
      if (request === "@solidjs/compiler-wasm32-wasi") {
        return {
          transform() {
            return { code: "wasm", map: null };
          }
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    try {
      const compilerPath = require.resolve("..");
      delete require.cache[compilerPath];
      const compiler = require("..");
      expect(compiler.transform("const value = 1")).toEqual({ code: "wasm", map: null });
    } finally {
      Module._load = originalLoad;
      if (forceWasi === undefined) delete process.env.NAPI_RS_FORCE_WASI;
      else process.env.NAPI_RS_FORCE_WASI = forceWasi;
    }
  });
});
