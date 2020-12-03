const { src, dest } = require("gulp");
const merge = require("merge-stream");

exports.copy = function () {
  return merge(
    src("./node_modules/dom-expressions/src/jsx.ts")
      .pipe(dest("./src/render/"))
      .pipe(dest("./src/static/")),

    src("./node_modules/dom-expressions/src/runtime.d.ts")
      .pipe(dest("./web/src/"))
      .pipe(dest("./web/types/")),

    src("./node_modules/dom-expressions/src/syncSSR.d.ts").pipe(dest("./web/server/")),

    src("./node_modules/dom-expressions/src/asyncSSR.d.ts").pipe(dest("./web/server-async/"))
  );
};
