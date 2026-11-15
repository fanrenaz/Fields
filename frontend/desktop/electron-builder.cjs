const path = require("node:path");

const appIcon = path.resolve(__dirname, "assets/fields.ico");

module.exports = {
  appId: "com.fields.desktop",
  electronVersion: "43.1.1",
  productName: "Fields",
  directories: {
    output: "out/make/nsis/x64",
  },
  artifactName: "Fields-${version}-Setup.${ext}",
  win: {
    icon: appIcon,
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
  },
  nsis: {
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    differentialPackage: false,
    displayLanguageSelector: true,
    guid: "6efa7baa-d482-48dc-b573-3199de32ae27",
    installerHeaderIcon: appIcon,
    installerIcon: appIcon,
    installerLanguages: ["en_US", "zh_CN"],
    multiLanguageInstaller: true,
    oneClick: false,
    perMachine: true,
    runAfterFinish: true,
    shortcutName: "Fields",
    uninstallDisplayName: "Fields",
    uninstallerIcon: appIcon,
  },
};
