const { init, Node, customElements, HTMLElement } = require("basichtml");

const { document, window } = init({});
global.window = window;
global.document = document;
global.Node = Node;
global.customElements = customElements;
global.HTMLElement = HTMLElement;
