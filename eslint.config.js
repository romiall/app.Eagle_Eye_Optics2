import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores([
    'node_modules/**',
    'vendor/**',
    'public/**',
    'storage/**',
    'bootstrap/cache/**',
    'test-results/**',
    'playwright-report/**',
    'specifications/**',
    'database/**',
    '.spec-work/**',
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs['flat/recommended'],

  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },

  {
    files: ['resources/frontend/**/*.{ts,vue}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // Le frontend est servi en fichiers statiques : aucune API Node dans le code applicatif.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: 'Le code frontend ne doit pas dépendre des API Node.',
            },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'vue/multi-word-component-names': 'off',
    },
  },

  {
    // Contrat 23 : « Les composants Vue appellent un service d'application, jamais une table Dexie
    // directement. » Écrans et composants passent par resources/frontend/app/services : ni Dexie,
    // ni rien de resources/frontend/offline, ni IndexedDB, par import statique ou dynamique.
    files: [
      'resources/frontend/components/**/*.{ts,vue}',
      'resources/frontend/pages/**/*.{ts,vue}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'dexie',
              message: 'Passer par un service d’application de resources/frontend/app/services.',
            },
            {
              name: '@/offline',
              message: 'Un écran ou un composant passe par resources/frontend/app/services.',
            },
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'Le code frontend ne doit pas dépendre des API Node.',
            },
            {
              group: ['dexie/**', '@/offline/**', '**/offline', '**/offline/**'],
              message:
                'Un écran ou un composant passe par resources/frontend/app/services, jamais par le moteur local.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/^(dexie|@\\/offline)|(^|\\/)offline(\\/|$)/]',
          message: 'Import dynamique du moteur local interdit : passer par app/services.',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'indexedDB',
          message: 'IndexedDB est réservé au dossier resources/frontend/offline.',
        },
      ],
    },
  },

  {
    // Les services d'application (app/) lisent les projections du moteur local, jamais ses tables
    // ni son journal : seul resources/frontend/offline accède à IndexedDB.
    files: ['resources/frontend/app/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'dexie',
              message: 'Accès aux tables locales réservé au dossier resources/frontend/offline.',
            },
            {
              name: '@/offline',
              message: 'Importer seulement les projections : @/offline/projections/….',
            },
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'Le code frontend ne doit pas dépendre des API Node.',
            },
            {
              group: [
                'dexie/**',
                '@/offline/**',
                '!@/offline/projections',
                '!@/offline/projections/**',
                // Façade du coffre (vault.md D26) : seul autre point d'entrée admis, sans table ni CryptoKey.
                '!@/offline/api',
                '**/offline/**',
                '!**/offline/projections',
                '!**/offline/projections/**',
                '!**/offline/api',
              ],
              message:
                'Les services d’application ne lisent que les projections du moteur local (@/offline/projections/…) et sa façade (@/offline/api).',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportExpression[source.value=/^dexie|(^|\\/)offline(\\/(?!projections(\\/|$))|$)/]',
          message: 'Import dynamique du moteur local interdit hors des projections.',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'indexedDB',
          message: 'IndexedDB est réservé au dossier resources/frontend/offline.',
        },
      ],
    },
  },

  {
    // Règles pures (domain/) et modèles de documents (documents/) : aucun stockage local.
    files: ['resources/frontend/domain/**/*.ts', 'resources/frontend/documents/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'dexie', message: 'Aucun stockage local dans les règles ni les modèles.' },
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'Le code frontend ne doit pas dépendre des API Node.',
            },
            {
              group: ['dexie/**', '@/offline', '@/offline/**', '**/offline', '**/offline/**'],
              message: 'Les règles et les modèles ne dépendent pas du moteur local.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/^(dexie|@\\/offline)|(^|\\/)offline(\\/|$)/]',
          message: 'Import dynamique du moteur local interdit : les règles ignorent le stockage.',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'indexedDB',
          message: 'IndexedDB est réservé au dossier resources/frontend/offline.',
        },
      ],
    },
  },

  {
    files: ['tests/frontend/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  {
    files: [
      'tests/e2e/**/*.{ts,mjs}',
      'contracts/tools/**/*.mjs',
      'tools/dev/**/*.mjs',
      '*.ts',
      '*.js',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  prettier,
])
