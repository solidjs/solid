// Server-function ids are keyed on IDENTITY, not position (#3109).
//
// The id is the address a deployed client already holds, so an edit that
// moves one silently re-points a call: before the fix the id was
// `<hash>-<ordinal>`, appending a function renumbered the rest, and an old
// tab calling getUser reached deleteUser with a 200. The fixture suite
// cannot see that — every fixture is a single fixed source, so it pins the
// id FORMAT and no fixture has a second version to compare against. This
// is the differential half: compile two versions of one file and require
// every surviving name to keep its address.

const path = require("path");

const compilerDir = path.resolve(__dirname, "..");
const { transformDirectives } = require(compilerDir);

const ROOT = "/app";
const FILENAME = "/app/src/api/users.ts";
const RUNTIME = "@solidjs/web/server-functions";

/** The extracted functions, as the production build emits them. */
function compile(source) {
  const result = transformDirectives(source, {
    filename: FILENAME,
    root: ROOT,
    mode: "server",
    env: "production",
    directive: "use server",
    register: { kind: "named", name: "registerServerReference", source: RUNTIME },
    create: { kind: "named", name: "createServerReference", source: RUNTIME }
  });
  return result.functions;
}

/** name -> wire id (callers here never register the same name twice). */
const idsOf = source => Object.fromEntries(compile(source).map(fn => [fn.name, fn.id]));

const fn = (name, body = `return "${name}";`) =>
  `export async function ${name}(x) { "use server"; ${body} }`;

describe("server-function ids survive an edit to their file", () => {
  const baseline = idsOf([fn("getUser"), fn("deleteUser")].join("\n"));

  const edits = {
    "a function appended at the end": [fn("getUser"), fn("deleteUser"), fn("archiveAccount")],
    "a function inserted at the top": [fn("ping"), fn("getUser"), fn("deleteUser")],
    "the first function deleted": [fn("deleteUser")],
    "the two reordered": [fn("deleteUser"), fn("getUser")],
    "a body edited": [fn("getUser", "return 42;"), fn("deleteUser")]
  };

  for (const [edit, source] of Object.entries(edits)) {
    test(`${edit} moves no surviving id`, () => {
      const after = idsOf(source.join("\n"));
      for (const [name, id] of Object.entries(after)) {
        if (name in baseline) expect(id).toBe(baseline[name]);
      }
    });
  }

  // The consequence of keying on the name, stated so it is a decision and
  // not a surprise: a rename IS a new address, and an old client calling
  // the old one gets a clean 404 (#3110) rather than another function.
  test("a rename is a new address, and does not take over another", () => {
    const after = idsOf([fn("fetchUser"), fn("deleteUser")].join("\n"));
    expect(after.deleteUser).toBe(baseline.deleteUser);
    expect(Object.values(after)).not.toContain(baseline.getUser);
  });
});

describe("a name that recurs in one file", () => {
  // The residual: among functions sharing a descriptive name, position
  // still decides, so deleting the first renumbers the second. Pinned as
  // known and accepted rather than left for someone to discover.
  const source = [
    `export const a = (() => { const handler = async () => { "use server"; return 1; }; return handler; })();`,
    `export const b = (() => { const handler = async () => { "use server"; return 2; }; return handler; })();`
  ].join("\n");

  test("disambiguates with a trailing ordinal", () => {
    const ids = compile(source).map(fn => fn.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^handler-[0-9a-f]{1,8}$/);
    expect(ids[1]).toMatch(/^handler-[0-9a-f]{1,8}-1$/);
  });
});
