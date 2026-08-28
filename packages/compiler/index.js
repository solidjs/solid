"use strict";

const fs = require("fs");
const path = require("path");

const native = requireBinding();

function transform(code, options) {
  if (typeof code !== "string") {
    throw new TypeError("@solidjs/compiler transform() expects source code as a string");
  }

  const nativeOptions = validateOptions(code, options);
  const result = native.transform(code, nativeOptions);
  const output = {
    code: result.code,
    map: result.map ?? null
  };
  // Preserve the established JSX result shape. Native TSRX transforms always
  // return a CSS string (including `""` when no styles are present), which
  // makes the sidecar fields a route-specific extension.
  if (result.css != null) {
    output.css = result.css;
    output.cssHash = result.cssHash ?? null;
  }
  return output;
}

function transformAsync(code, options) {
  return Promise.resolve().then(() => transform(code, options));
}

function transformDirectives(code, options) {
  if (typeof code !== "string") {
    throw new TypeError("@solidjs/compiler transformDirectives() expects source code as a string");
  }

  const nativeOptions = validateDirectivesOptions(options);
  const result = native.transformDirectives(code, nativeOptions);
  return {
    code: result.code,
    map: result.map ?? null,
    valid: result.valid,
    functions: result.functions
  };
}

function transformDirectivesAsync(code, options) {
  return Promise.resolve().then(() => transformDirectives(code, options));
}

function transformLazy(code, options) {
  if (typeof code !== "string") {
    throw new TypeError("@solidjs/compiler transformLazy() expects source code as a string");
  }

  const nativeOptions = validateLazyOptions(options);
  const result = native.transformLazy(code, nativeOptions);
  return {
    code: result.code,
    map: result.map ?? null
  };
}

function transformLazyAsync(code, options) {
  return Promise.resolve().then(() => transformLazy(code, options));
}

function transformRefresh(code, options) {
  if (typeof code !== "string") {
    throw new TypeError("@solidjs/compiler transformRefresh() expects source code as a string");
  }

  const nativeOptions = validateRefreshOptions(options);
  const result = native.transformRefresh(code, nativeOptions);
  return {
    code: result.code,
    map: result.map ?? null
  };
}

function transformRefreshAsync(code, options) {
  return Promise.resolve().then(() => transformRefresh(code, options));
}

const lazyOptionKeys = new Set(["filename", "sourceMap"]);

function validateLazyOptions(options) {
  if (options == null) return options;
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("@solidjs/compiler transformLazy() expects options to be an object");
  }

  const nativeOptions = {};
  for (const [key, value] of Object.entries(options)) {
    if (!lazyOptionKeys.has(key)) {
      throw new Error(`@solidjs/compiler received unknown option \`${key}\``);
    }
    if (key === "filename" && typeof value !== "string") {
      throw new TypeError("@solidjs/compiler `filename` option must be a string");
    }
    if (key === "sourceMap" && typeof value !== "boolean") {
      throw new TypeError("@solidjs/compiler `sourceMap` option must be boolean");
    }
    nativeOptions[key] = value;
  }
  return nativeOptions;
}

const refreshOptionKeys = new Set([
  "filename",
  "bundler",
  "fixRender",
  "granular",
  "jsx",
  "importSource",
  "sourceMap"
]);

const refreshBundlers = new Set(["esm", "vite", "webpack5", "rspack-esm", "standard"]);

function validateRefreshOptions(options) {
  if (options == null) return options;
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("@solidjs/compiler transformRefresh() expects options to be an object");
  }

  const nativeOptions = {};
  for (const [key, value] of Object.entries(options)) {
    if (!refreshOptionKeys.has(key)) {
      throw new Error(`@solidjs/compiler received unknown option \`${key}\``);
    }
    if ((key === "filename" || key === "importSource") && typeof value !== "string") {
      throw new TypeError(`@solidjs/compiler \`${key}\` option must be a string`);
    }
    if (
      (key === "fixRender" || key === "granular" || key === "sourceMap") &&
      typeof value !== "boolean"
    ) {
      throw new TypeError(`@solidjs/compiler \`${key}\` option must be boolean`);
    }
    if (key === "bundler" && !refreshBundlers.has(value)) {
      throw new TypeError(
        '@solidjs/compiler `bundler` option must be "esm", "vite", "webpack5", "rspack-esm" or "standard"'
      );
    }
    if (key === "jsx") {
      // The Babel plugin's JSX-granularity mode (its default!) is not
      // ported; only the vite-plugin-solid configuration (`jsx: false`) is.
      if (value !== false) {
        throw new Error(
          "@solidjs/compiler transformRefresh() does not support `jsx: true` yet; pass `jsx: false`"
        );
      }
      nativeOptions.jsx = false;
      continue;
    }
    nativeOptions[key] = value;
  }
  return nativeOptions;
}

const directivesOptionKeys = new Set([
  "filename",
  "root",
  "mode",
  "env",
  "directive",
  "sourceMap",
  "register",
  "create"
]);

function validateDirectivesOptions(options) {
  if (options == null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("@solidjs/compiler transformDirectives() expects options to be an object");
  }

  const nativeOptions = {};
  for (const [key, value] of Object.entries(options)) {
    if (!directivesOptionKeys.has(key)) {
      throw new Error(`@solidjs/compiler received unknown option \`${key}\``);
    }
    if (key === "mode") {
      if (value !== "server" && value !== "client") {
        throw new TypeError('@solidjs/compiler `mode` option must be "server" or "client"');
      }
    }
    if (key === "env") {
      if (value !== "production" && value !== "development") {
        throw new TypeError('@solidjs/compiler `env` option must be "production" or "development"');
      }
    }
    if (key === "register" || key === "create") {
      validateImportDefinition(key, value);
    }
    nativeOptions[key] = value;
  }
  if (typeof nativeOptions.filename !== "string") {
    throw new TypeError("@solidjs/compiler transformDirectives() requires `filename`");
  }
  return nativeOptions;
}

function validateImportDefinition(key, value) {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new TypeError(`@solidjs/compiler \`${key}\` option must be an object`);
  }
  for (const nested of Object.keys(value)) {
    if (nested !== "kind" && nested !== "name" && nested !== "source") {
      throw new Error(`@solidjs/compiler received unknown \`${key}\` option \`${nested}\``);
    }
  }
  if (typeof value.source !== "string") {
    throw new TypeError(`@solidjs/compiler \`${key}.source\` must be a string`);
  }
  if (value.kind != null && value.kind !== "named" && value.kind !== "default") {
    throw new TypeError(`@solidjs/compiler \`${key}.kind\` must be "named" or "default"`);
  }
}

const nativeOptionKeys = new Set([
  "filename",
  "moduleName",
  "generate",
  "hydratable",
  "dev",
  "sourceMap",
  "contextToCustomElements",
  "delegateEvents",
  "delegatedEvents",
  "omitQuotes",
  "omitAttributeSpacing",
  "inlineStyles",
  "effectWrapper",
  "wrapConditionals",
  "memoWrapper",
  "requireImportSource",
  "validate",
  "staticMarker",
  "omitNestedClosingTags",
  "omitLastClosingTag",
  "serverComponents",
  "builtIns",
  "renderers"
]);

function validateOptions(code, options) {
  if (options == null) return options;
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("@solidjs/compiler transform() expects options to be an object");
  }

  const nativeOptions = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === "effectWrapper" || key === "memoWrapper") {
      if (typeof value !== "string" && typeof value !== "boolean") {
        throw new TypeError(
          `@solidjs/compiler \`${key}\` option must be a string import name or false`
        );
      }
      nativeOptions[key] = value;
      continue;
    }
    if (key === "requireImportSource") {
      if (value !== false && typeof value !== "string") {
        throw new TypeError(
          "@solidjs/compiler `requireImportSource` option must be false or a string"
        );
      }
      if (value !== false) nativeOptions.requireImportSource = value;
      continue;
    }
    if (key === "wrapConditionals") {
      if (typeof value !== "boolean") {
        throw new TypeError("@solidjs/compiler `wrapConditionals` option must be boolean");
      }
      nativeOptions.wrapConditionals = value;
      continue;
    }
    if (key === "validate") {
      if (typeof value !== "boolean") {
        throw new TypeError("@solidjs/compiler `validate` option must be boolean");
      }
      nativeOptions.validate = value;
      continue;
    }
    if (nativeOptionKeys.has(key)) {
      if (key === "renderers") validateRenderers(value);
      nativeOptions[key] = value;
      continue;
    }
    throw new Error(`@solidjs/compiler received unknown option \`${key}\``);
  }
  return nativeOptions;
}

function validateRenderers(renderers) {
  if (renderers == null) return;
  if (!Array.isArray(renderers)) {
    throw new TypeError("@solidjs/compiler `renderers` option must be an array");
  }

  for (const renderer of renderers) {
    if (typeof renderer !== "object" || renderer == null || Array.isArray(renderer)) {
      throw new TypeError("@solidjs/compiler renderer entries must be objects");
    }
    for (const key of Object.keys(renderer)) {
      if (key !== "name" && key !== "moduleName" && key !== "elements") {
        throw new Error(`@solidjs/compiler received unknown renderer option \`${key}\``);
      }
    }
    if (renderer.name !== "dom") {
      throw new Error(
        "@solidjs/compiler dynamic renderers only support the `dom` renderer override"
      );
    }
  }
}

function platformArchSuffix() {
  const { platform, arch } = process;
  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) return `darwin-${arch}`;
  if (platform === "linux" && (arch === "x64" || arch === "arm64")) return `linux-${arch}-gnu`;
  if (platform === "win32" && arch === "x64") return "win32-x64-msvc";
  return null;
}

function tryPackage(packageName) {
  try {
    return { binding: require(packageName) };
  } catch (error) {
    if (isMissingPackage(error, packageName)) return { missing: true };
    return { error };
  }
}

function requireBinding() {
  const explicit = process.env.SOLID_COMPILER_NATIVE;
  if (explicit) return require(explicit);

  const forceWasi = process.env.NAPI_RS_FORCE_WASI;
  if (forceWasi === "true" || forceWasi === "error") {
    const wasi = requireWasi();
    if (wasi) return wasi;
    if (forceWasi === "error") {
      throw new Error("WASI binding not found and NAPI_RS_FORCE_WASI is set to error");
    }
  }

  let nativeError;
  const suffix = platformArchSuffix();

  if (suffix) {
    const next = tryPackage(`@solidjs/compiler-${suffix}`);
    if (next.binding) return next.binding;
    if (next.error) nativeError = next.error;
  }

  const localCandidates = [];
  if (suffix) localCandidates.push(`compiler.${suffix}.node`);
  localCandidates.push("compiler.node");
  for (const file of localCandidates) {
    const full = path.join(__dirname, file);
    if (fs.existsSync(full)) {
      try {
        return require(full);
      } catch (error) {
        nativeError = error;
        break;
      }
    }
  }

  const wasi = requireWasi();
  if (wasi) return wasi;

  if (nativeError) {
    nativeError.message +=
      "\nThe native binding could not be loaded and the optional " +
      "@solidjs/compiler-wasm32-wasi fallback is not installed.";
    throw nativeError;
  }

  throw new Error(
    `Could not find an @solidjs/compiler binding for ${process.platform}-${process.arch}` +
      (suffix
        ? ` (expected @solidjs/compiler-${suffix}, @solidjs/compiler-wasm32-wasi, or a local build)`
        : " (no prebuilt binary is published for this platform)") +
      ". Install with WASM support or run `pnpm run build` in packages/compiler."
  );
}

function requireWasi() {
  const next = tryPackage("@solidjs/compiler-wasm32-wasi");
  if (next.binding) return next.binding;
  if (next.error) throw next.error;

  const localWasi = path.join(__dirname, "compiler.wasi.cjs");
  if (fs.existsSync(localWasi)) return require(localWasi);
  return null;
}

function isMissingPackage(error, packageName) {
  return (
    error &&
    error.code === "MODULE_NOT_FOUND" &&
    typeof error.message === "string" &&
    error.message.includes(`'${packageName}'`)
  );
}

module.exports = {
  transform,
  transformAsync,
  transformDirectives,
  transformDirectivesAsync,
  transformLazy,
  transformLazyAsync,
  transformRefresh,
  transformRefreshAsync
};
