const NodeEnvironment = require('jest-environment-node');
require('./register');

module.exports = class extends NodeEnvironment {
  constructor(config) {
    super(config);
    Object.assign(this.context, global);
  }
  setup() {
    return Promise.resolve();
  }

  teardown() {
    return Promise.resolve();
  }
};