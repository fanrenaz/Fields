import path from "node:path";
import { fileURLToPath } from "node:url";

import stylistic from "@stylistic/eslint-plugin";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

import { architectureRules } from "./architecture-rules.js";

const sourceFiles = ["**/*.{ts,tsx}"];
const testFiles = ["**/*.test.{ts,tsx}", "**/tests/**/*.{ts,tsx}", "**/test_*.{ts,tsx}"];
const backendArchitectureFiles = [
  "src/index.ts",
  "src/domain/**/*.{ts,tsx}",
  "src/application/**/*.{ts,tsx}",
  "src/infrastructure/**/*.{ts,tsx}",
  "src/interface/**/*.{ts,tsx}",
  "src/composition/**/*.{ts,tsx}",
];
const desktopArchitectureFiles = [
  "app/**/*.{ts,tsx}",
  "data/**/*.{ts,tsx}",
  "features/**/*.{ts,tsx}",
  "shared/**/*.{ts,tsx}",
  "tests/**/*.{ts,tsx}",
];
const backendOwners = ["company", "actor", "room", "execution"];
const providerModules = [
  "@better-auth/**",
  "@fastify/**",
  "@trpc/**",
  "better-auth",
  "better-auth/**",
  "dockerode",
  "dockerode/**",
  "drizzle-orm",
  "drizzle-orm/**",
  "fastify",
  "fastify/**",
];
const approvedFrontendContractsPattern = "^@fields/contracts(?:$|/(?!public/[^/]+$|router/backend$).*)$";
const nodeNextResolverPath = fileURLToPath(new URL("./node-next-resolver.cjs", import.meta.url));

export function createFieldsTypeScriptConfig({ tsconfigRootDir, ignores = [] }) {
  return [
    {
      ignores: [
        "dist/**",
        "artifacts/**",
        "node_modules/**",
        "coverage/**",
        ".expo/**",
        ".tamagui/**",
        ...ignores,
      ],
    },
    ...[tseslint.configs.base].map((config) => ({
      ...config,
      files: sourceFiles,
    })),
    {
      files: sourceFiles,
      languageOptions: {
        parserOptions: {
          project: "./tsconfig.json",
          tsconfigRootDir,
        },
      },
      plugins: {
        "@stylistic": stylistic,
      },
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            args: "all",
            argsIgnorePattern: "^_",
            caughtErrors: "all",
            caughtErrorsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
          },
        ],
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": "error",
        "@stylistic/array-bracket-spacing": ["error", "never"],
        "@stylistic/block-spacing": ["error", "always"],
        "@stylistic/comma-dangle": ["error", "always-multiline"],
        "@stylistic/eol-last": ["error", "always"],
        "@stylistic/indent": ["error", 2, { "SwitchCase": 1 }],
        "@stylistic/object-curly-spacing": ["error", "always"],
        "@stylistic/quotes": [
          "error",
          "double",
          { "allowTemplateLiterals": "always", "avoidEscape": true },
        ],
        "@stylistic/semi": ["error", "always"],
        "@stylistic/no-trailing-spaces": "error",
      },
    },
    {
      files: testFiles,
      rules: {
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-misused-promises": "off",
      },
    },
  ];
}

function desktopBoundaryPolicies() {
  return [
    {
      from: { element: { types: "data" } },
      disallow: {
        to: {
          element: {
            types: { anyOf: ["app", "feature", "shared-ui", "shared-platform"] },
          },
        },
      },
      message: "Data code may not import app, feature, shared UI, or platform implementation code.",
    },
    {
      from: { element: { types: "feature" } },
      disallow: { to: { element: { types: "app" } } },
      message: "Feature code may not import app composition code.",
    },
    {
      from: { element: { types: { anyOf: ["shared-i18n", "shared-platform", "shared-types", "shared-ui"] } } },
      disallow: {
        to: { element: { types: { anyOf: ["app", "data", "feature"] } } },
      },
      message: "Shared code may not import app, data, or feature code.",
    },
  ];
}

function desktopBoundaryRuleOptions() {
  return {
    default: "allow",
    checkAllOrigins: true,
    checkInternals: true,
    checkUnknownLocals: true,
    policies: desktopBoundaryPolicies(),
  };
}

export function createFieldsDesktopConfig({ tsconfigRootDir, ignores = [] }) {
  const rootDir = path.resolve(tsconfigRootDir);

  return [
    ...createFieldsTypeScriptConfig({ tsconfigRootDir, ignores }),
    {
      files: desktopArchitectureFiles,
      plugins: { boundaries },
      settings: {
        "import/resolver": {
          [nodeNextResolverPath]: {},
        },
        "boundaries/root-path": rootDir,
        "boundaries/elements": [
          { type: "app", pattern: "app/**", partialMatch: false },
          { type: "data", pattern: "data/**", partialMatch: false },
          { type: "feature", pattern: "features/**", partialMatch: false },
          { type: "shared-i18n", pattern: "shared/i18n/**", partialMatch: false },
          { type: "shared-platform", pattern: "shared/platform/**", partialMatch: false },
          { type: "shared-types", pattern: "shared/types/**", partialMatch: false },
          { type: "shared-ui", pattern: "shared/ui/**", partialMatch: false },
          { type: "test", pattern: "tests/**", partialMatch: false },
        ],
      },
      rules: {
        "boundaries/dependencies": ["error", desktopBoundaryRuleOptions()],
        "no-restricted-imports": [
          "error",
          {
            patterns: [{
              regex: approvedFrontendContractsPattern,
              message: "Frontend code may import only @fields/contracts/public/* or @fields/contracts/router/backend.",
            }],
          },
        ],
      },
    },
  ];
}

function crossOwnerPersistencePolicies() {
  return backendOwners.flatMap((fromOwner) =>
    backendOwners
      .filter((toOwner) => toOwner !== fromOwner)
      .map((toOwner) => ({
        from: {
          element: {
            parent: {
              types: { anyOf: ["persistence-repository", "persistence-schema"] },
              captured: { owner: fromOwner },
            },
          },
        },
        disallow: {
          to: {
            element: {
              parent: {
                types: { anyOf: ["persistence-repository", "persistence-schema"] },
                captured: { owner: toOwner },
              },
            },
          },
        },
        message: "An owner may not import another owner's persistence Schema or Repository internals.",
      })),
  );
}

function backendBoundaryPolicies({ allowDomainTestNodeModules = false } = {}) {
  const policies = [
    {
      from: { element: { types: "domain" } },
      disallow: {
        to: {
          element: {
            types: { anyOf: ["application", "infrastructure", "interface", "composition"] },
          },
        },
      },
      message: "Domain code may not import an outer Backend layer.",
    },
    {
      from: { element: { types: "domain" } },
      disallow: { to: { module: { origin: "external" } } },
      message: "Domain code may not import external modules, including @fields/contracts.",
    },
    {
      from: { element: { types: "domain" } },
      disallow: { dependency: { source: ["@fields/contracts", "@fields/contracts/**"] } },
      message: "Domain code may not import @fields/contracts through a workspace link.",
    },
    {
      from: { element: { types: "application" } },
      disallow: {
        to: {
          element: {
            types: { anyOf: ["infrastructure", "interface", "composition"] },
          },
        },
      },
      message: "Application code may not import Infrastructure, Interface, or Composition code.",
    },
    {
      from: { element: { types: "application" } },
      disallow: { to: { module: { origin: "external", source: providerModules } } },
      message: "Application code may not import a provider implementation library.",
    },
    {
      from: { element: { types: "interface" } },
      disallow: { to: { element: { types: "infrastructure" } } },
      message: "Interface code may not import Infrastructure code.",
    },
    {
      from: { element: { types: "interface" } },
      disallow: { to: { element: { types: "composition" } } },
      message: "Interface code may not import Composition code.",
    },
    {
      from: { element: { types: "infrastructure" } },
      disallow: {
        to: { element: { types: { anyOf: ["interface", "composition"] } } },
      },
      message: "Infrastructure code may not import Interface or Composition code.",
    },
    ...crossOwnerPersistencePolicies(),
  ];

  if (allowDomainTestNodeModules) {
    policies.push({
      from: { element: { types: "domain" } },
      allow: {
        to: {
          module: {
            origin: "external",
            source: ["node:assert/strict", "node:test"],
          },
        },
      },
      message: "Domain unit tests may use Node's built-in test modules.",
    });
  }

  return policies;
}

function backendBoundaryRuleOptions(options) {
  return {
    default: "allow",
    checkAllOrigins: true,
    checkInternals: true,
    checkUnknownLocals: true,
    policies: backendBoundaryPolicies(options),
  };
}

export function createFieldsBackendConfig({ tsconfigRootDir, ignores = [] }) {
  const rootDir = path.resolve(tsconfigRootDir);

  return [
    ...createFieldsTypeScriptConfig({ tsconfigRootDir, ignores }),
    {
      files: backendArchitectureFiles,
      settings: {
        "import/resolver": {
          [nodeNextResolverPath]: {},
        },
      },
    },
    {
      files: backendArchitectureFiles,
      plugins: {
        boundaries,
        "fields-architecture": { rules: architectureRules },
      },
      settings: {
        "boundaries/root-path": rootDir,
        "boundaries/elements": [
          {
            type: "domain",
            pattern: "src/domain/*",
            capture: ["owner"],
            partialMatch: false,
          },
          {
            type: "application",
            pattern: "src/application/*",
            capture: ["owner"],
            partialMatch: false,
          },
          {
            type: "infrastructure",
            pattern: "src/infrastructure/*",
            capture: ["area"],
            partialMatch: false,
          },
          {
            type: "interface",
            pattern: "src/interface/*",
            capture: ["surface"],
            partialMatch: false,
          },
          {
            type: "composition",
            pattern: "src/composition/*",
            capture: ["root"],
            partialMatch: false,
          },
          {
            type: "persistence-schema",
            pattern: "src/infrastructure/persistence/postgres/schema/*",
            capture: ["owner"],
            partialMatch: false,
          },
          {
            type: "persistence-repository",
            pattern: "src/infrastructure/persistence/postgres/repositories/*",
            capture: ["owner"],
            partialMatch: false,
          },
        ],
      },
      rules: {
        "boundaries/dependencies": [
          "error",
          backendBoundaryRuleOptions(),
        ],
        "fields-architecture/no-layer-dependency": ["error", { rootDir }],
        "fields-architecture/no-port-adapter-co-import": ["error", { rootDir }],
        "fields-architecture/no-circular-dependencies": ["error", { rootDir }],
        "fields-architecture/no-root-entrypoint-implementation": ["error", { rootDir }],
      },
    },
    {
      files: ["src/domain/**/*.test.{ts,tsx}"],
      rules: {
        "boundaries/dependencies": ["error", backendBoundaryRuleOptions({ allowDomainTestNodeModules: true })],
      },
    },
  ];
}
