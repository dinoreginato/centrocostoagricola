import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-empty': 'warn',
      'prefer-const': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ['src/contexts/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/pages/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/contexts/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../supabase/client', '../../supabase/client', '../../../supabase/client', '**/supabase/client'],
              message: 'Importa supabase sólo en src/services/* (usa services en UI/contexts).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/pages/Reports.tsx'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: [
      'src/pages/Fuel.tsx',
      'src/pages/GeneralCosts.tsx',
      'src/pages/Invoices.tsx',
      'src/pages/Irrigation.tsx',
      'src/pages/Labors.tsx',
      'src/pages/Machinery.tsx',
    ],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
)
