module.exports = (request, options) => {
  return options.defaultResolver(request, {
    ...options,
    packageFilter: pkg => {
      return {
        ...pkg,
        main: pkg.browser || pkg.module || pkg.main,
      };
    },
  });
};