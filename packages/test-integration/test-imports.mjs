import { createRequire } from "node:module";

function checkError(error) {
  // This error happens when missing the type:module field in package.json when it is needed.
  if (
    error instanceof SyntaxError &&
    error.message.includes("Cannot use import statement outside a module")
  ) {
    console.error(error);
    process.exit(1);
  }

  // These errors happen if exports are not mapped to files that should be importable.
  // ERR_REQUIRE_ASYNC_MODULE is the `require()` half: every package ships ESM
  // only and relies on Node's require(esm), which refuses a graph containing
  // a top-level await — a CJS host would be locked out of that entry.
  if (
    [
      "ERR_PACKAGE_PATH_NOT_EXPORTED",
      "ERR_MODULE_NOT_FOUND",
      "MODULE_NOT_FOUND",
      "ERR_REQUIRE_ASYNC_MODULE"
    ].includes(error.code)
  ) {
    console.error(error);
    process.exit(1);
  }

  // Any other errors (unless I missed any that should be added to the checks
  // above) are errors that happen after imported modules are successfully
  // resolved (f.e. a module was found, but it doesn't export a particular
  // identifier when running in node vs browser).  SO we silence them by not
  // re-throwing them here as we don't want to fail the test in those cases,
  // because we're testing only that ESM exports are set up correctly.
  // Importing `solid-js/h` will fail in node even if modules are resolved
  // properly, for example.
}

const specifiers = [
  "solid-js",
  "solid-js/attribution",

  "@solidjs/signals",
  "@solidjs/signals/attribution",
  "@solidjs/web",
  "@solidjs/web/jsx-runtime",
  "@solidjs/web/jsx-dev-runtime",
  "@solidjs/web/storage",
  "@solidjs/web/serialization",
  "@solidjs/web/serialization/decode",
  "@solidjs/web/server-functions",
  "@solidjs/web/server-functions/server",
  "@solidjs/web/server-functions/client",
  "@solidjs/web/server-functions/rich-args",
  "@solidjs/web/frames",
  "@solidjs/web/frames/server",
  "@solidjs/web/frames/client",

  "@solidjs/h",
  "@solidjs/h/jsx-runtime",
  "@solidjs/h/jsx-dev-runtime",
  "@solidjs/html",
  "@solidjs/universal"
];

// The same entries through a CommonJS `require()`: there is no `require`
// branch in any exports map, so this must land on the ESM files and load them
// synchronously (Node >= 22.12). Failing here means a CJS host cannot load
// that entry at all.
const require = createRequire(import.meta.url);
for (const specifier of specifiers) {
  try {
    require(specifier);
  } catch (error) {
    checkError(error);
  }
}

Promise.all(specifiers.map(specifier => import(specifier).catch(checkError)))
  .then(() => {
    console.log("ES Module import + require(esm) test passed.");
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
