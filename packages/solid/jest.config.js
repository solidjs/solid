module.exports = {
  verbose: false,
  collectCoverageFrom: ["src/**/{!(runtime|ssr|asyncSSR),}", "!src/server/*"],
  resolver: "jest-ts-webcompat-resolver",
  transformIgnorePatterns: ["node_modules/?!(dom-expressions)"]
};
