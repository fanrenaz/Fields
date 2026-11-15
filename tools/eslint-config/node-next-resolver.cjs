"use strict";

const fs = require("node:fs");
const { builtinModules, createRequire } = require("node:module");
const path = require("node:path");

const coreModules = new Set(builtinModules);
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts"];
const runtimeExtensions = [".js", ".mjs", ".cjs", ".json"];

function existingFile(candidate) {
  try {
    return fs.statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function localCandidates(source, importer) {
  const base = path.resolve(path.dirname(importer), source);
  const extension = path.extname(base);
  const candidates = [base];

  if ([".js", ".mjs", ".cjs"].includes(extension)) {
    const withoutExtension = base.slice(0, -extension.length);
    candidates.push(...sourceExtensions.map((sourceExtension) => `${withoutExtension}${sourceExtension}`));
  } else if (extension.length === 0) {
    candidates.push(...runtimeExtensions.map((runtimeExtension) => `${base}${runtimeExtension}`));
    candidates.push(...sourceExtensions.map((sourceExtension) => `${base}${sourceExtension}`));
  }

  candidates.push(
    ...runtimeExtensions.map((runtimeExtension) => path.join(base, `index${runtimeExtension}`)),
  );
  candidates.push(
    ...sourceExtensions.map((sourceExtension) => path.join(base, `index${sourceExtension}`)),
  );

  return candidates;
}

function resolveLocalSource(source, importer) {
  for (const candidate of localCandidates(source, importer)) {
    const resolved = existingFile(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function resolveExternalSource(source, importer) {
  try {
    return createRequire(importer).resolve(source);
  } catch {
    return undefined;
  }
}

function isCoreModule(source) {
  return source.startsWith("node:") || coreModules.has(source);
}

function isLocalSpecifier(source) {
  return source.startsWith(".") || path.isAbsolute(source);
}

function resolveSource(source, importer) {
  if (isCoreModule(source)) {
    return null;
  }

  if (isLocalSpecifier(source)) {
    return resolveLocalSource(source, importer);
  }

  return resolveExternalSource(source, importer);
}

exports.interfaceVersion = 2;
exports.resolve = (source, importer) => {
  const resolved = resolveSource(source, importer);

  if (resolved === undefined) {
    return { found: false };
  }

  return { found: true, path: resolved };
};
exports.resolveSource = resolveSource;
exports.isCoreModule = isCoreModule;
exports.isLocalSpecifier = isLocalSpecifier;
