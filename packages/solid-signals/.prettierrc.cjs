module.exports = {
  singleQuote: false,
  semi: true,
  arrowParens: 'avoid',
  trailingComma: 'none',
  printWidth: 100,
  tabWidth: 2,
  plugins: [require.resolve('@ianvs/prettier-plugin-sort-imports')],
};
