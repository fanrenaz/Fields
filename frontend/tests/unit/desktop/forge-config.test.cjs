const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const configPath = path.resolve(__dirname, "../../../forge.config.cjs");
const builderConfigPath = path.resolve(__dirname, "../../../desktop/electron-builder.cjs");

function loadConfig() {
  delete require.cache[configPath];
  return require(configPath);
}

test("packager contains only the manifest, desktop runtime, and fresh renderer export", () => {
  const config = loadConfig();
  const ignored = config.packagerConfig.ignore;

  assert.equal(ignored("/package.json"), false);
  assert.equal(ignored("/desktop/main.cjs"), false);
  assert.equal(ignored("\\desktop\\assets\\fields.ico"), false);
  assert.equal(ignored("/artifacts"), false);
  assert.equal(ignored("/artifacts/renderer/index.html"), false);
  assert.equal(ignored("/artifacts/old/index.html"), true);
  assert.equal(ignored("/.env"), true);
  assert.equal(ignored("/App.tsx"), true);
  assert.equal(ignored("/tests/unit/desktop/example.test.cjs"), true);
  assert.equal(ignored("/desktop/example.test.cjs"), true);
  assert.equal(ignored("/desktop/export.cjs"), true);
});

test("NSIS uses a bilingual assisted per-machine installer", () => {
  const config = loadConfig();
  delete require.cache[builderConfigPath];
  const builder = require(builderConfigPath);
  const installer = builder.nsis;

  assert.equal(config.packagerConfig.name, "Fields");
  assert.equal(config.packagerConfig.executableName, "Fields");
  assert.deepEqual(config.makers, []);
  assert.equal(builder.appId, "com.fields.desktop");
  assert.equal(builder.electronVersion, "43.1.1");
  assert.equal(builder.artifactName, "Fields-${version}-Setup.${ext}");
  assert.deepEqual(builder.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(installer.oneClick, false);
  assert.equal(installer.perMachine, true);
  assert.equal(installer.allowElevation, true);
  assert.equal(installer.allowToChangeInstallationDirectory, true);
  assert.equal(installer.displayLanguageSelector, true);
  assert.equal(installer.multiLanguageInstaller, true);
  assert.deepEqual(installer.installerLanguages, ["en_US", "zh_CN"]);
  assert.match(installer.guid, /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/u);
  assert.equal(installer.deleteAppDataOnUninstall, false);
  assert.equal(installer.differentialPackage, false);
});

test("packager hook stages the desktop entrypoint without runtime dependencies", async (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fields-package-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(temporaryDirectory, "package.json"),
    JSON.stringify({ name: "@fields/frontend", version: "1.0.1" }),
  );

  const config = loadConfig();
  await new Promise((resolve, reject) => {
    config.packagerConfig.afterCopy[0](
      temporaryDirectory,
      "43.1.1",
      process.platform,
      process.arch,
      (error) => error ? reject(error) : resolve(),
    );
  });

  const stagedPackage = JSON.parse(
    fs.readFileSync(path.join(temporaryDirectory, "package.json"), "utf8"),
  );
  assert.equal(stagedPackage.main, "desktop/main.cjs");
  assert.equal(stagedPackage.productName, "Fields");
  assert.equal(fs.existsSync(path.join(temporaryDirectory, "node_modules")), false);
});

test("Windows package keeps only product-supported Chromium locales", async (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fields-locales-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const localesDirectory = path.join(temporaryDirectory, "locales");
  fs.mkdirSync(localesDirectory);
  for (const locale of ["en-US.pak", "zh-CN.pak", "zh-TW.pak", "de.pak", "ja.pak"]) {
    fs.writeFileSync(path.join(localesDirectory, locale), locale);
  }
  fs.writeFileSync(path.join(localesDirectory, "README.txt"), "not a locale");

  const config = loadConfig();
  await new Promise((resolve, reject) => {
    config.packagerConfig.afterExtract[0](
      temporaryDirectory,
      "43.1.1",
      "win32",
      "x64",
      (error) => error ? reject(error) : resolve(),
    );
  });

  assert.deepEqual(
    fs.readdirSync(localesDirectory).sort(),
    ["README.txt", "en-US.pak", "zh-CN.pak", "zh-TW.pak"],
  );
});

test("Windows locale pruning fails when an app-supported locale is unavailable", async (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fields-locales-missing-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const localesDirectory = path.join(temporaryDirectory, "locales");
  fs.mkdirSync(localesDirectory);
  fs.writeFileSync(path.join(localesDirectory, "en-US.pak"), "en-US");

  const config = loadConfig();
  await assert.rejects(
    new Promise((resolve, reject) => {
      config.packagerConfig.afterExtract[0](
        temporaryDirectory,
        "43.1.1",
        "win32",
        "x64",
        (error) => error ? reject(error) : resolve(),
      );
    }),
    /missing required Chromium locales: zh-CN\.pak, zh-TW\.pak/u,
  );
});

test("desktop renderer omits source maps while other Vite builds retain them", () => {
  const vite = fs.readFileSync(path.resolve(__dirname, "../../../vite.config.ts"), "utf8");
  assert.match(vite, /sourcemap:\s*mode !== "desktop"/u);
});

test("desktop runtime uses a provider-neutral Windows application identity", () => {
  const runtime = fs.readFileSync(path.resolve(__dirname, "../../../desktop/runtime-main.cjs"), "utf8");
  assert.match(runtime, /windowsAppUserModelId = "com\.fields\.desktop"/u);
  assert.doesNotMatch(runtime, /squirrel/iu);
  assert.doesNotMatch(runtime, /autoUpdater/u);
});

test("desktop lifecycle is single-instance, tray-resident, and explicitly quit", () => {
  const bootstrap = fs.readFileSync(path.resolve(__dirname, "../../../desktop/main.cjs"), "utf8");
  const main = fs.readFileSync(path.resolve(__dirname, "../../../desktop/runtime-main.cjs"), "utf8");
  assert.match(bootstrap, /requestSingleInstanceLock\(\)/u);
  assert.match(bootstrap, /store\.markFailed[\s\S]*app\.relaunch\(\)[\s\S]*app\.exit\(1\)/u);
  assert.match(main, /new Tray\(/u);
  assert.match(main, /event\.preventDefault\(\);\s*window\.hide\(\)/u);
  assert.match(main, /setLoginItemSettings\(\{ openAtLogin: enabled/u);
  assert.match(main, /isQuitting = true; app\.quit\(\)/u);
});

test("native notifications and updates remain behind trusted Desktop IPC", () => {
  const bootstrap = fs.readFileSync(path.resolve(__dirname, "../../../desktop/main.cjs"), "utf8");
  const main = fs.readFileSync(path.resolve(__dirname, "../../../desktop/runtime-main.cjs"), "utf8");
  assert.match(main, /fields:notification:show/u);
  assert.match(main, /trustedDesktopEvent\(event\)/u);
  assert.match(main, /notificationEventIds/u);
  assert.match(bootstrap, /DesktopUpdateController/u);
  assert.match(bootstrap, /trustedDesktopEvent\(event\)/u);
});

test("desktop runtime uses the native window-controls overlay without an application menu", () => {
  const main = fs.readFileSync(path.resolve(__dirname, "../../../desktop/runtime-main.cjs"), "utf8");

  assert.match(main, /backgroundColor: "#FEFEFE"/u);
  assert.match(main, /titleBarStyle: "hidden"/u);
  assert.match(main, /titleBarOverlay:\s*\{[^]*?color: "#FEFEFE"[^]*?symbolColor: "#1B1813"[^]*?height: 44/u);
  assert.match(main, /window\.removeMenu\(\)/u);
  assert.doesNotMatch(main, /frame: false/u);
  assert.match(main, /ipcMain/u);
  assert.match(main, /preload: preloadPath/u);
  assert.match(main, /trustedDesktopEvent/u);
  assert.match(main, /contextIsolation: true/u);
  assert.match(main, /nodeIntegration: false/u);
  assert.match(main, /sandbox: true/u);
});

test("external Runtime uses stable shell assets and identifies its release on product requests", () => {
  const main = fs.readFileSync(path.resolve(__dirname, "../../../desktop/runtime-main.cjs"), "utf8");
  assert.match(main, /path\.join\(app\.getAppPath\(\), "desktop", "assets", "fields\.ico"\)/u);
  assert.match(main, /runtimeRelease: runtimeRelease\.releaseId/u);
  assert.doesNotMatch(main, /path\.join\(__dirname, "assets"/u);
});

test("desktop browser keeps arbitrary HTTPS content sandboxed behind the Fields tunnel", () => {
  const controller = fs.readFileSync(path.resolve(__dirname, "../../../desktop/browser-controller.cjs"), "utf8");
  const tunnel = fs.readFileSync(path.resolve(__dirname, "../../../desktop/browser-tunnel.cjs"), "utf8");
  const preload = fs.readFileSync(path.resolve(__dirname, "../../../desktop/preload.cjs"), "utf8");
  assert.match(controller, /WebContentsView/u);
  assert.match(controller, /nodeIntegration: false/u);
  assert.match(controller, /contextIsolation: true/u);
  assert.match(controller, /sandbox: true/u);
  assert.match(controller, /persist:fields-browser-/u);
  assert.match(controller, /storagePartition/u);
  assert.match(controller, /tunnelUrl\.protocol !== "wss:"/u);
  assert.match(controller, /createWindow/u);
  assert.match(tunnel, /127\.0\.0\.1/u);
  assert.match(tunnel, /fields-token\./u);
  assert.match(tunnel, /fields-nonce\./u);
  assert.match(tunnel, /MAX_PROXY_HEADER_BYTES/u);
  assert.doesNotMatch(preload, /ipcRenderer:\s*ipcRenderer/u);
});

test("formal desktop artifacts are intentionally unsigned", () => {
  const config = loadConfig();
  delete require.cache[builderConfigPath];
  const builder = require(builderConfigPath);
  assert.equal(config.packagerConfig.windowsSign, undefined);
  assert.equal(builder.win.sign, undefined);
  assert.equal(builder.cscLink, undefined);
});
