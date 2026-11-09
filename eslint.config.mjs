// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        // Use the standard Node.js __dirname via import.meta.url and URL for ESM
        tsconfigRootDir: new URL('.', import.meta.url).pathname,
      },
    },
  },
  {
    rules: {
      // This service interacts heavily with dynamically-typed boundaries
      // (Prisma JSON, Fastify req/socket handshakes, third-party SDKs), so the
      // `any`-propagation family is treated as advisory rather than blocking —
      // consistent with `no-explicit-any` being off. They remain visible as
      // warnings for incremental hardening. Rules that catch real defects
      // (unused code, etc.) stay as errors and are enforced in CI.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/unbound-method': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Intentional CommonJS requires: Sentry must be initialised before any
    // other import is evaluated, and Fastify plugins are loaded dynamically
    // inside bootstrap() for ESM/CJS interop.
    files: ['src/instrument.ts', 'src/main.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
