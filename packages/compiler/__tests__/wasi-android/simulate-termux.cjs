"use strict";

// Preloaded with `--require`. Reproduces Android/Termux, where the
// filesystem root cannot be opened: Node's `uvwasi_init` fails with
// UVWASI_EACCES for a WASI preopen of the host root (#3748).
// SIMULATE_ANDROID=1 also reports the platform as Android, the signal the
// generated loader keys its accessible root on.

const path = require("node:path");
const wasi = require("node:wasi");

if (process.env.SIMULATE_ANDROID === "1") {
  Object.defineProperty(process, "platform", { value: "android" });
}

const hostRoot = path.parse(process.cwd()).root;
const NodeWASI = wasi.WASI;
wasi.WASI = class extends NodeWASI {
  constructor(options = {}) {
    for (const host of Object.values(options.preopens || {})) {
      if (path.resolve(host) === hostRoot) {
        const error = new Error("UVWASI_EACCES, uvwasi_init");
        error.code = "UVWASI_EACCES";
        throw error;
      }
    }
    super(options);
  }
};
