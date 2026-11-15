const fsPromises = require("node:fs/promises");
const path = require("node:path");

const appIcon = path.resolve(__dirname, "desktop/assets/fields.ico");
const packagedChromiumLocales = new Set(["en-US.pak", "zh-CN.pak", "zh-TW.pak"]);

function normalizedPackagedPath(filePath) {
  return filePath
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function keepPackagedFile(filePath) {
  const relativePath = normalizedPackagedPath(filePath);

  if (relativePath.length === 0) {
    return false;
  }

  const isPackageManifest = relativePath === "package.json";
  const isDesktopRuntime = relativePath === "desktop" || (
    relativePath.startsWith("desktop/") &&
    relativePath !== "desktop/export.cjs" &&
    !relativePath.endsWith(".test.cjs")
  );
  const isRendererExport = relativePath === "artifacts" ||
    relativePath === "artifacts/renderer" ||
    relativePath.startsWith("artifacts/renderer/");

  return !(isPackageManifest || isDesktopRuntime || isRendererExport);
}

async function stagePackageManifest(buildPath) {
  const stagedPackageJsonPath = path.join(buildPath, "package.json");
  await fsPromises.readFile(stagedPackageJsonPath, "utf8")
    .then((contents) => ({
      ...JSON.parse(contents),
      main: "desktop/main.cjs",
      productName: "Fields",
    }))
    .then((packageJson) => fsPromises.writeFile(
      stagedPackageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
    ));
}

function updatePackageManifest(buildPath, _electronVersion, _platform, _arch, callback) {
  stagePackageManifest(buildPath)
    .then(() => callback())
    .catch(callback);
}

function pruneChromiumLocales(buildPath, _electronVersion, platform, _arch, callback) {
  if (platform !== "win32") {
    callback();
    return;
  }

  const localesDirectory = path.join(buildPath, "locales");
  fsPromises.readdir(localesDirectory, { withFileTypes: true })
    .then(async (entries) => {
      const localeFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".pak"))
        .map((entry) => entry.name);
      const missingLocales = [...packagedChromiumLocales]
        .filter((locale) => !localeFiles.includes(locale));
      if (missingLocales.length > 0) {
        throw new Error(`Electron package is missing required Chromium locales: ${missingLocales.join(", ")}`);
      }

      const unusedLocales = localeFiles
        .filter((locale) => !packagedChromiumLocales.has(locale));
      await Promise.all(unusedLocales.map((locale) => fsPromises.rm(
        path.join(localesDirectory, locale),
        { force: true },
      )));
      console.log(
        `[desktop:package] pruned ${unusedLocales.length} Chromium locales; kept ${[...packagedChromiumLocales].join(", ")}`,
      );
    })
    .then(() => callback())
    .catch(callback);
}

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const forgeConfig = {
  packagerConfig: {
    name: "Fields",
    executableName: "Fields",
    asar: true,
    afterExtract: [pruneChromiumLocales],
    afterCopy: [updatePackageManifest],
    icon: appIcon,
    ignore: keepPackagedFile,
    prune: false,
    win32metadata: {
      CompanyName: "Fields AI",
      FileDescription: "Fields desktop client",
      InternalName: "Fields",
      OriginalFilename: "Fields.exe",
      ProductName: "Fields",
      "requested-execution-level": "asInvoker",
    },
  },
  makers: [],
};

module.exports = forgeConfig;
