var styled = require("styled-jsx/babel").default;
var rename = require("babel-plugin-transform-rename-import").default;

// parcel/codesandbox had issues with preset so we have this monstrosity.
module.exports = babel => {
  const s = styled(babel),
    r = rename(babel);
  return {
    visitor: {
      Program: {
        enter: (path, state) => {
          s.visitor.Program.enter(path, state);
          s.visitor.Program.exit(path, state);
          path.traverse(r.visitor, {
            ...state,
            opts: {
              original: "styled-jsx/style",
              replacement: "solid-styled-jsx/style"
            }
          });
        }
      }
    }
  };
};
