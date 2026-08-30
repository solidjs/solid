// The server-function wire id is a CONTRACT, not an implementation detail:
// it is baked into client bundles, server manifests, rendered form-action
// urls and shared-cache keys, so every producer — today's native pass, any
// future second implementation, and a human mapping an id back to a file —
// must derive the same id from the same input (solidjs/solid#3109, #3120).
//
// The scheme: `<name>-<xxhash32(root-relative path)>[-<ordinal>]`, ordinal
// only when the same derived name recurs in one module, assigned in the
// order the transform visits functions (post-bubble program order — the
// repeated-names fixture pins that order byte-for-byte). The name is a JS
// identifier and never contains `-`, so `id.split("-")[1]` is always the
// file hash — vite-plugin-solid's dev server relies on exactly that read.
//
// This suite is the differential half: expected ids are computed here by an
// INDEPENDENT implementation — the xxhash32 the retired Babel pass used
// (hoisted from solid-start, still the normative hash) plus the documented
// format — and compared against what `transformDirectives` reports. A
// change to the hash, the relative-path derivation, or the format turns
// this red even if the frozen fixtures were regenerated wholesale.

const path = require("path");
const { transformDirectives } = require(path.resolve(__dirname, ".."));

// --- Independent xxhash32 (Jason Dent's, via solid-start / the retired
// --- Babel implementation in vite-plugin-solid@c052963e) -------------------

const PRIME32_1 = 2654435761;
const PRIME32_2 = 2246822519;
const PRIME32_3 = 3266489917;
const PRIME32_4 = 668265263;
const PRIME32_5 = 374761393;

function toUtf8(text) {
  const bytes = [];
  for (let i = 0, n = text.length; i < n; ++i) {
    const c = text.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (text.charCodeAt(++i) & 0x3ff));
      bytes.push(
        0xf0 | ((cp >> 18) & 0x7),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }
  return new Uint8Array(bytes);
}

function xxHash32(input, seed = 0) {
  const b = toUtf8(input);
  let acc = (seed + PRIME32_5) & 0xffffffff;
  let offset = 0;

  if (b.length >= 16) {
    const accN = [
      (seed + PRIME32_1 + PRIME32_2) & 0xffffffff,
      (seed + PRIME32_2) & 0xffffffff,
      (seed + 0) & 0xffffffff,
      (seed - PRIME32_1) & 0xffffffff
    ];
    const limit = b.length - 16;
    let lane = 0;
    for (offset = 0; (offset & 0xfffffff0) <= limit; offset += 4) {
      const i = offset;
      const laneN0 = b[i + 0] + (b[i + 1] << 8);
      const laneN1 = b[i + 2] + (b[i + 3] << 8);
      const laneNP = laneN0 * PRIME32_2 + ((laneN1 * PRIME32_2) << 16);
      let lacc = (accN[lane] + laneNP) & 0xffffffff;
      lacc = (lacc << 13) | (lacc >>> 19);
      accN[lane] = ((lacc & 0xffff) * PRIME32_1 + (((lacc >>> 16) * PRIME32_1) << 16)) & 0xffffffff;
      lane = (lane + 1) & 0x3;
    }
    acc =
      (((accN[0] << 1) | (accN[0] >>> 31)) +
        ((accN[1] << 7) | (accN[1] >>> 25)) +
        ((accN[2] << 12) | (accN[2] >>> 20)) +
        ((accN[3] << 18) | (accN[3] >>> 14))) &
      0xffffffff;
  }

  acc = (acc + b.length) & 0xffffffff;

  const limit = b.length - 4;
  for (; offset <= limit; offset += 4) {
    const i = offset;
    const laneN0 = b[i + 0] + (b[i + 1] << 8);
    const laneN1 = b[i + 2] + (b[i + 3] << 8);
    const laneP = laneN0 * PRIME32_3 + ((laneN1 * PRIME32_3) << 16);
    acc = (acc + laneP) & 0xffffffff;
    acc = (acc << 17) | (acc >>> 15);
    acc = ((acc & 0xffff) * PRIME32_4 + (((acc >>> 16) * PRIME32_4) << 16)) & 0xffffffff;
  }

  for (; offset < b.length; ++offset) {
    acc += b[offset] * PRIME32_5;
    acc = (acc << 11) | (acc >>> 21);
    acc = ((acc & 0xffff) * PRIME32_1 + (((acc >>> 16) * PRIME32_1) << 16)) & 0xffffffff;
  }

  acc ^= acc >>> 15;
  acc = (((acc & 0xffff) * PRIME32_2) & 0xffffffff) + (((acc >>> 16) * PRIME32_2) << 16);
  acc ^= acc >>> 13;
  acc = (((acc & 0xffff) * PRIME32_3) & 0xffffffff) + (((acc >>> 16) * PRIME32_3) << 16);
  acc ^= acc >>> 16;

  return acc < 0 ? acc + 4294967296 : acc;
}

const hashHex = input => xxHash32(input, 0).toString(16);

// --- Compiling --------------------------------------------------------------

const RUNTIME = "@solidjs/web/server-functions";

function ids(source, { filename, root, mode = "server" }) {
  const result = transformDirectives(source, {
    filename,
    root,
    mode,
    env: "production",
    directive: "use server",
    register: { kind: "named", name: "registerServerReference", source: RUNTIME },
    create: { kind: "named", name: "createServerReference", source: RUNTIME }
  });
  expect(result.valid).toBe(true);
  return result.functions.map(fn => fn.id);
}

const SIMPLE = `export const save = async data => {\n  "use server";\n  return data;\n};\n`;

describe("the wire id scheme, differentially", () => {
  it("derives <name>-<xxhash32(root-relative path)>", () => {
    expect(ids(SIMPLE, { filename: "/project/src/routes/checkout.js", root: "/project" })).toEqual([
      `save-${hashHex("src/routes/checkout.js")}`
    ]);
  });

  it("hashes the path relative to the configured root", () => {
    // Same file on disk, different root: the id must not bake in the
    // machine-specific prefix, only the root-relative identity.
    expect(ids(SIMPLE, { filename: "/project/src/a.js", root: "/project" })).toEqual([
      `save-${hashHex("src/a.js")}`
    ]);
    expect(ids(SIMPLE, { filename: "/project/src/a.js", root: "/project/src" })).toEqual([
      `save-${hashHex("a.js")}`
    ]);
  });

  it("keys on the file: identical source in two files gets two ids", () => {
    const [a] = ids(SIMPLE, { filename: "/project/src/a.js", root: "/project" });
    const [b] = ids(SIMPLE, { filename: "/project/src/b.js", root: "/project" });
    expect(a).not.toBe(b);
    expect(a.split("-")[0]).toBe("save");
    expect(b.split("-")[0]).toBe("save");
  });

  it("hashes utf-8 bytes for non-ascii paths", () => {
    expect(ids(SIMPLE, { filename: "/project/src/café.js", root: "/project" })).toEqual([
      `save-${hashHex("src/café.js")}`
    ]);
  });

  it("suffixes an ordinal only when a name recurs, in visit order", () => {
    const source = `
      export function makeA() {
        const submit = async data => {
          "use server";
          return ["a", data];
        };
        return submit;
      }
      export function makeB() {
        const submit = async data => {
          "use server";
          return ["b", data];
        };
        return submit;
      }
    `;
    const hash = hashHex("src/forms.js");
    // Post-bubble program order: top-level function declarations are
    // hoisted in reverse source order (the frozen Babel reference's
    // behavior — see the repeated-names fixture), so makeB's submit takes
    // the bare id. This assignment IS the wire contract; a traversal
    // change that flips it re-points deployed addresses.
    expect(ids(source, { filename: "/project/src/forms.js", root: "/project" })).toEqual([
      `submit-${hash}`,
      `submit-${hash}-1`
    ]);
  });

  it("keeps the hash readable as id.split('-')[1] — names never carry dashes", () => {
    const source = `
      export const save = async data => {
        "use server";
        return data;
      };
      export function makeOther() {
        const submit = async data => {
          "use server";
          return data;
        };
        return submit;
      }
    `;
    const hash = hashHex("src/mixed.js");
    for (const id of ids(source, { filename: "/project/src/mixed.js", root: "/project" })) {
      expect(id.split("-")[1]).toBe(hash);
    }
  });

  it("reports identical ids for the client and server builds of one module", () => {
    const source = `
      export function makeA() {
        const submit = async data => {
          "use server";
          return ["a", data];
        };
        return submit;
      }
      export const save = async data => {
        "use server";
        return data;
      };
    `;
    const options = { filename: "/project/src/pair.js", root: "/project" };
    expect(ids(source, { ...options, mode: "client" })).toEqual(
      ids(source, { ...options, mode: "server" })
    );
  });
});
