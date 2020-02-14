const { init, Node } = require("basichtml");

const { document, window } = init({});
global.window = window;
global.document = document;
global.Node = Node;
