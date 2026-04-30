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
  if (["ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_MODULE_NOT_FOUND"].includes(error.code)) {
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

Promise.all([
  import("solid-js").catch(checkError),

  import("@solidjs/signals").catch(checkError),
  import("@solidjs/web").catch(checkError),
  import("@solidjs/web/jsx-runtime").catch(checkError),
  import("@solidjs/web/jsx-dev-runtime").catch(checkError),
  import("@solidjs/web/storage").catch(checkError),

  import("@solidjs/h").catch(checkError),
  import("@solidjs/h/jsx-runtime").catch(checkError),
  import("@solidjs/h/jsx-dev-runtime").catch(checkError),
  import("@solidjs/html").catch(checkError),
  import("@solidjs/universal").catch(checkError)
])
  .then(() => {
    console.log("ES Module import test passed.");
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
