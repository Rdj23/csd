import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'backend/node_modules', 'mcp/node_modules']),

  // ── Frontend (Vite / React) ───────────────────────────────────────────
  // Scoped to src/ specifically. It used to match **/*.{js,jsx}, which meant
  // the React rules were also applied to backend files — and, worse, that
  // backend files were linted with BROWSER globals, so `process`, `Buffer`
  // and `global` all reported as no-undef. That noise is why nobody ran lint
  // on the backend, and why a real `redisGetRaw is not defined` sat
  // undetected in syncService until it OOM-killed production on 2026-08-08.
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },

  // ── Backend (Node / ESM) ──────────────────────────────────────────────
  // The single rule that matters here is no-undef. A missing import is a
  // ReferenceError that only fires when that exact line executes — in the
  // 2026-08-08 incident, that was the very end of a successful 8k-ticket
  // sync, a path no test covered and manual QA never reached. Static
  // analysis catches it in milliseconds; production caught it with an OOM.
  //
  // no-unused-vars is a WARNING, not an error, on purpose: the backend has a
  // backlog of unused imports, and failing the build on them would push
  // people to bypass lint entirely, taking no-undef down with it. Warnings
  // stay visible; only genuine defects break the build.
  {
    files: ['backend/**/*.js', 'mcp/**/*.js', 'scripts/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.node },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-undef': 'error',
      // Everything below is style, not correctness, and all of it predates
      // this config. Kept as warnings so `lint:backend --quiet` (and therefore
      // CI) fails ONLY on a genuine defect. A lint gate that is red on arrival
      // gets switched off, and then it protects nothing.
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'warn',
    },
  },
])
