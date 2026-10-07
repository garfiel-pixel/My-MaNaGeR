const globals = require('globals');

const scriptRules = {
  curly: 'warn',
  eqeqeq: ['warn', 'always', { null: 'ignore' }],
  'no-extra-semi': 'warn',
  'no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
  ],
  'no-console': 'off',
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-fallthrough': 'warn',
  'no-redeclare': 'warn',
  'no-delete-var': 'warn',
  'no-shadow-restricted-names': 'warn',
  'no-undef': 'warn',
  'no-unexpected-multiline': 'warn',
  'no-floating-promises': 'off',
  'consistent-return': 'off',
  'default-case': 'off',
  'no-empty-function': 'off',
  'no-return-await': 'off',
  'require-await': 'off',
  yoda: 'off',
  'guard-for-in': 'off',
  'no-label-var': 'off',
  'no-loop-func': 'off',
  'no-param-reassign': 'off',
  'no-shadow': 'off',
  'no-use-before-define': 'off',
  'prefer-const': 'off',
  'vars-on-top': 'off',
  strict: 'off',
  semi: 'off',
  quotes: 'off',
  indent: 'off',
  'brace-style': 'off',
  'space-before-function-paren': 'off',
  'space-before-blocks': 'off',
  'keyword-spacing': 'off',
  'comma-spacing': 'off',
  'key-spacing': 'off',
  'object-curly-spacing': 'off',
  'operator-spacing': 'off',
  'max-len': 'off',
  'max-lines': 'off',
  'max-params': 'off',
  'max-statements': 'off',
  complexity: 'off',
  'id-length': 'off',
  'no-bitwise': 'off',
  'no-plusplus': 'off',
  'no-continue': 'off',
  'no-else-return': 'off',
  'no-restricted-syntax': 'off'
};

const baseIgorables = ['node_modules/', 'dist/', '.wrangler/', 'vendor/', 'tmp/', '_archive/'];

module.exports = [
  {
    ignores: baseIgorables
  },
  {
    files: ['worker.js', 'src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2021
      }
    },
    rules: scriptRules
  },
  {
    files: ['js/**/*.js', 'tools/**/*.cjs', '*.cjs', '*.mjs', 'build.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021
      }
    },
    rules: scriptRules
  }
];
