import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [{ files: ['**/*.ts'], languageOptions: { parser }, plugins: { '@typescript-eslint': plugin }, rules: {
  ...plugin.configs.recommended.rules,
  '@typescript-eslint/no-non-null-assertion': 'error',
  'no-restricted-imports': ['error', { patterns: ['@fnx/sl-engine*', 'pixi*'] }]
}}];
