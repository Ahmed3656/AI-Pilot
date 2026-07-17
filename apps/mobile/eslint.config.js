const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['dist/**', '.expo/**'],
    rules: {
      // TypeScript resolves the @/* alias; the import plugin traverses outside the
      // repository on Windows when checking it and can fail on protected folders.
      'import/no-unresolved': 'off',
    },
  },
]);
