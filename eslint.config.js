import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const renderingLibraries = {
  patterns: [
    {
      group: ['phaser', 'phaser/*', 'three', 'three/*'],
      message: 'Simulation, core and data code must stay renderer-free.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'playwright-report', 'test-results', 'tools'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: [
      'src/runner/sim/**',
      'src/core/**',
      'src/data/**',
      'src/stations/*/logic/**',
      'src/bench/logic/**',
      'functions/**',
    ],
    rules: { 'no-restricted-imports': ['error', renderingLibraries] },
  },
  prettier,
);
