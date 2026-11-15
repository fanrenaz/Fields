import path from "node:path";

import nodeNextResolver from "./node-next-resolver.cjs";

const architectureLayers = new Set([
  "domain",
  "application",
  "infrastructure",
  "interface",
  "composition",
]);
const ownerNames = new Set(["company", "actor", "room", "execution"]);
const flatPersistenceOwnerByStem = new Map([
  // The schemas own the same facts as their corresponding Application owner.
  ["actor", "actor"],
  ["company", "company"],
  ["room", "room"],

  // These adapters are classified by the facts they own, rather than the
  // consumer Port's directory or a word in the filename.
  ["actor-directory-repository", "actor"],
  ["actor-invitation-human-query", "actor"],
  ["actor-repository", "actor"],
  ["actor-room-access-query", "actor"],
  ["company-invitation-query", "company"],
  ["company-repository", "company"],
  ["room-repository", "room"],
]);
const flatPersistencePlatformStems = new Set([
  // Better Auth, durable eventing, cross-owner relation metadata, and barrels
  // are Infrastructure/platform concerns rather than product Owner facts.
  "better-auth",
  "eventing",
  "index",
  "relations",
  // Notifications are cross-owner delivery metadata keyed by Company and Actor.
  "notification",
  "notification-repository",
  // This test-only fixture verifies the approved Company + Actor creation UoW.
  "company-actor-repository",
]);
const approvedCrossOwnerSchemaMetadataPairs = new Set();
const graphsByRoot = new Map();

function isPathInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative.length === 0 || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function relativeParts(fileName, rootDir) {
  return path.relative(rootDir, fileName).split(path.sep);
}

function layerForFile(fileName, rootDir) {
  if (!isPathInside(fileName, rootDir)) {
    return undefined;
  }

  const [sourceRoot, layer] = relativeParts(fileName, rootDir);
  return sourceRoot === "src" && architectureLayers.has(layer) ? layer : undefined;
}

function isRootEntrypoint(fileName, rootDir) {
  const parts = relativeParts(fileName, rootDir);
  return parts.length === 2 && parts[0] === "src" && parts[1] === "index.ts";
}

function ownerForFile(fileName, rootDir) {
  const parts = relativeParts(fileName, rootDir);
  const owner = parts.find((part) => ownerNames.has(part));
  if (owner) {
    return owner;
  }

  const classification = flatPersistenceClassificationForFile(fileName, rootDir);
  return classification?.kind === "owner" ? classification.owner : undefined;
}

function fileStem(fileName) {
  return fileName.replace(/(?:\.test)?\.(?:ts|tsx)$/, "");
}

function isPersistenceInternal(fileName, rootDir) {
  const parts = relativeParts(fileName, rootDir);
  return parts.includes("persistence") && parts.includes("postgres") && (
    parts.includes("schema") || parts.includes("repositories")
  );
}

function isFlatPersistenceOwnerFile(fileName, rootDir) {
  const parts = relativeParts(fileName, rootDir);
  const areaIndex = parts.findIndex((part) => part === "schema" || part === "repositories");
  return areaIndex !== -1 && areaIndex + 2 === parts.length;
}

function isApprovedCrossOwnerSchemaMetadataDependency(sourceFile, targetFile, rootDir) {
  const sourceParts = relativeParts(sourceFile, rootDir);
  const targetParts = relativeParts(targetFile, rootDir);
  const sourceSchema = sourceParts.at(-2) === "schema" && isFlatPersistenceOwnerFile(sourceFile, rootDir);
  const targetSchema = targetParts.at(-2) === "schema" && isFlatPersistenceOwnerFile(targetFile, rootDir);
  if (!sourceSchema || !targetSchema) {
    return false;
  }
  const sourceStem = fileStem(sourceParts.at(-1) ?? "");
  const targetStem = fileStem(targetParts.at(-1) ?? "");
  return approvedCrossOwnerSchemaMetadataPairs.has(`${sourceStem}->${targetStem}`);
}

function flatPersistenceClassificationForFile(fileName, rootDir) {
  if (!isFlatPersistenceOwnerFile(fileName, rootDir)) {
    return undefined;
  }

  const stem = fileStem(relativeParts(fileName, rootDir).at(-1) ?? "");
  const owner = flatPersistenceOwnerByStem.get(stem);
  if (owner) {
    return { kind: "owner", owner };
  }
  if (flatPersistencePlatformStems.has(stem)) {
    return { kind: "platform" };
  }
  return { kind: "unclassified" };
}

function isApplicationPort(fileName, rootDir) {
  const parts = relativeParts(fileName, rootDir);
  return parts[0] === "src" && parts[1] === "application" && parts.includes("ports");
}

function isPublicOwnerQueryEntry(fileName, rootDir) {
  const parts = relativeParts(fileName, rootDir);
  return (
    parts[0] === "src" &&
    parts[1] === "application" &&
    ownerNames.has(parts[2]) &&
    parts[3] === "queries" &&
    parts[4] === "index.ts" &&
    parts.length === 5
  );
}

function sourceValue(node) {
  if (node.type === "CallExpression") {
    const argument = node.arguments[0];
    return argument?.type === "Literal" && typeof argument.value === "string" ? argument.value : undefined;
  }

  return typeof node.source?.value === "string" ? node.source.value : undefined;
}

function collectDependencyNode(dependencies, node) {
  const source = sourceValue(node);
  if (source) {
    dependencies.push({ node, source });
  }
}

function dependencyVisitors(dependencies) {
  return {
    ImportDeclaration(node) {
      collectDependencyNode(dependencies, node);
    },
    ExportAllDeclaration(node) {
      collectDependencyNode(dependencies, node);
    },
    ExportNamedDeclaration(node) {
      if (node.source) {
        collectDependencyNode(dependencies, node);
      }
    },
    ImportExpression(node) {
      collectDependencyNode(dependencies, node);
    },
    CallExpression(node) {
      if (node.callee.type === "Identifier" && node.callee.name === "require") {
        collectDependencyNode(dependencies, node);
      }
    },
  };
}

function resolvedDependencies(dependencies, fileName) {
  return dependencies.flatMap(({ node, source }) => {
    const resolved = nodeNextResolver.resolveSource(source, fileName);
    return typeof resolved === "string" ? [{ node, source, resolved: path.resolve(resolved) }] : [];
  });
}

function findPath(graph, from, target, visited = new Set()) {
  if (from === target) {
    return [from];
  }

  if (visited.has(from)) {
    return undefined;
  }

  visited.add(from);
  for (const next of graph.get(from) ?? []) {
    const trail = findPath(graph, next, target, visited);
    if (trail) {
      return [from, ...trail];
    }
  }

  return undefined;
}

function describePath(fileName, rootDir) {
  return path.relative(rootDir, fileName).split(path.sep).join("/");
}

function ruleOptions(context) {
  const options = context.options[0] ?? {};
  return {
    rootDir: path.resolve(options.rootDir ?? context.cwd),
  };
}

const noLayerDependency = {
  meta: {
    type: "problem",
    schema: [{ type: "object", properties: { rootDir: { type: "string" } }, additionalProperties: false }],
    messages: {
      domainOtherOwner: "Domain code may not import another owner's Domain code.",
      domainUnknownLocal: "Domain code may not import a local module outside the Domain layer.",
      crossOwnerApplication: "An Application owner may consume another owner only through that owner's public Query entry.",
      crossOwnerApplicationDomain: "An Application owner may not import another owner's Domain model directly.",
      crossOwnerPersistence: "An owner may not import another owner's persistence Schema or Repository internals.",
      unclassifiedFlatPersistence: "Flat persistence Schema or Repository files must be classified as an Owner or platform concern.",
    },
  },
  create(context) {
    const { rootDir } = ruleOptions(context);
    const fileName = path.resolve(context.filename);
    const layer = layerForFile(fileName, rootDir);

    if (!layer) {
      return {};
    }

    const sourceOwner = ownerForFile(fileName, rootDir);
    const dependencies = [];

    return {
      ...dependencyVisitors(dependencies),
      "Program:exit"() {
        if (flatPersistenceClassificationForFile(fileName, rootDir)?.kind === "unclassified") {
          context.report({
            node: context.getSourceCode().ast,
            messageId: "unclassifiedFlatPersistence",
          });
        }

        for (const dependency of resolvedDependencies(dependencies, fileName)) {
          const targetLayer = layerForFile(dependency.resolved, rootDir);
          const targetOwner = ownerForFile(dependency.resolved, rootDir);

          if (
            layer === "domain" &&
            nodeNextResolver.isLocalSpecifier(dependency.source) &&
            !targetLayer
          ) {
            context.report({ node: dependency.node, messageId: "domainUnknownLocal" });
          }

          if (
            layer === "domain" &&
            targetLayer === "domain" &&
            sourceOwner &&
            targetOwner &&
            sourceOwner !== targetOwner
          ) {
            context.report({ node: dependency.node, messageId: "domainOtherOwner" });
          }

          if (
            layer === "application" &&
            sourceOwner &&
            targetLayer === "application" &&
            targetOwner &&
            sourceOwner !== targetOwner &&
            !isPublicOwnerQueryEntry(dependency.resolved, rootDir)
          ) {
            context.report({ node: dependency.node, messageId: "crossOwnerApplication" });
          }

          if (
            layer === "application" &&
            sourceOwner &&
            targetLayer === "domain" &&
            targetOwner &&
            sourceOwner !== targetOwner
          ) {
            context.report({ node: dependency.node, messageId: "crossOwnerApplicationDomain" });
          }

          if (
            layer !== "composition" &&
            sourceOwner &&
            targetOwner &&
            sourceOwner !== targetOwner &&
            isPersistenceInternal(dependency.resolved, rootDir) &&
            !isApprovedCrossOwnerSchemaMetadataDependency(fileName, dependency.resolved, rootDir)
          ) {
            context.report({ node: dependency.node, messageId: "crossOwnerPersistence" });
          }
        }
      },
    };
  },
};

const noPortAdapterCoImport = {
  meta: {
    type: "problem",
    schema: [{ type: "object", properties: { rootDir: { type: "string" } }, additionalProperties: false }],
    messages: {
      portAdapterCoImport: "Only Composition may import both an Application Port and a concrete Infrastructure Adapter.",
    },
  },
  create(context) {
    const { rootDir } = ruleOptions(context);
    const fileName = path.resolve(context.filename);
    const layer = layerForFile(fileName, rootDir);
    const dependencies = [];

    // A concrete Infrastructure adapter necessarily imports its Application
    // Port and may import an Infrastructure-local transaction/helper adapter.
    // The prohibited direction is a consumer layer wiring a Port to a
    // concrete adapter; boundary rules already forbid that from Application
    // and Interface. Treating an Infrastructure implementation itself as the
    // consumer would make transaction-bound repositories impossible.
    if (!layer || layer === "composition" || layer === "infrastructure") {
      return {};
    }

    return {
      ...dependencyVisitors(dependencies),
      "Program:exit"() {
        const resolved = resolvedDependencies(dependencies, fileName);
        const hasPort = resolved.some(({ resolved: dependency }) => isApplicationPort(dependency, rootDir));

        if (!hasPort) {
          return;
        }

        for (const dependency of resolved) {
          if (layerForFile(dependency.resolved, rootDir) === "infrastructure") {
            context.report({ node: dependency.node, messageId: "portAdapterCoImport" });
          }
        }
      },
    };
  },
};

const noCircularDependencies = {
  meta: {
    type: "problem",
    schema: [{ type: "object", properties: { rootDir: { type: "string" } }, additionalProperties: false }],
    messages: {
      circularDependency: "Circular dependency detected: {{ cycle }}.",
    },
  },
  create(context) {
    const { rootDir } = ruleOptions(context);
    const fileName = path.resolve(context.filename);
    const layer = layerForFile(fileName, rootDir);
    const dependencies = [];

    if (!layer) {
      return {};
    }

    return {
      ...dependencyVisitors(dependencies),
      "Program:exit"() {
        const graph = graphsByRoot.get(rootDir) ?? new Map();
        graphsByRoot.set(rootDir, graph);

        const resolved = resolvedDependencies(dependencies, fileName).filter(({ resolved: dependency }) =>
          layerForFile(dependency, rootDir),
        );
        graph.set(fileName, new Set(resolved.map(({ resolved: dependency }) => dependency)));

        for (const dependency of resolved) {
          const trail = findPath(graph, dependency.resolved, fileName);
          if (trail) {
            context.report({
              node: dependency.node,
              messageId: "circularDependency",
              data: {
                cycle: [...trail, dependency.resolved]
                  .map((entry) => describePath(entry, rootDir))
                  .join(" -> "),
              },
            });
          }
        }
      },
    };
  },
};

const allowedRootEntrypointImports = new Set([
  "node:process",
  "node:url",
  "./composition/api/server.js",
  "./interface/trpc/router.js",
]);
const allowedRootEntrypointExports = new Set([
  "./composition/api/server.js",
  "./interface/trpc/router.js",
]);

const noRootEntrypointImplementation = {
  meta: {
    type: "problem",
    schema: [{ type: "object", properties: { rootDir: { type: "string" } }, additionalProperties: false }],
    messages: {
      rootEntrypointImport: "Backend src/index.ts may import only its composition compatibility surface and Node launcher modules.",
      rootEntrypointExport: "Backend src/index.ts may re-export only its composition compatibility surface.",
      rootEntrypointStatement: "Backend src/index.ts may contain only imports, re-exports, and the direct main launcher.",
    },
  },
  create(context) {
    const { rootDir } = ruleOptions(context);
    const fileName = path.resolve(context.filename);
    if (!isRootEntrypoint(fileName, rootDir)) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        if (!allowedRootEntrypointImports.has(node.source.value)) {
          context.report({ node, messageId: "rootEntrypointImport" });
        }
      },
      ExportNamedDeclaration(node) {
        if (!node.source || !allowedRootEntrypointExports.has(node.source.value)) {
          context.report({ node, messageId: "rootEntrypointExport" });
        }
      },
      ExportDefaultDeclaration(node) {
        context.report({ node, messageId: "rootEntrypointExport" });
      },
      Program(node) {
        for (const statement of node.body) {
          if (
            statement.type !== "ImportDeclaration"
            && statement.type !== "ExportNamedDeclaration"
            && statement.type !== "IfStatement"
          ) {
            context.report({ node: statement, messageId: "rootEntrypointStatement" });
          }
        }
      },
    };
  },
};

export const architectureRules = {
  "no-layer-dependency": noLayerDependency,
  "no-port-adapter-co-import": noPortAdapterCoImport,
  "no-circular-dependencies": noCircularDependencies,
  "no-root-entrypoint-implementation": noRootEntrypointImplementation,
};

export function resetArchitectureRuleState() {
  graphsByRoot.clear();
}
