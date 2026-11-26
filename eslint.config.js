const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', '.venv/', 'build/', 'release/'] },
  js.configs.recommended,
  {
    files: ['static/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser }
  },
  {
    files: ['main.js', 'desktop-preload.js', 'eslint.config.js', 'scripts/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node }
  },
  {
    // Browser code runs inside page.evaluate(), hence the browser globals.
    files: ['tests/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser, __lanChat: 'readonly' }
    }
  }
];
