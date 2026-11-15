const PRODUCTION_ORIGIN = "https://fields.example.com";

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function navigationAction(value) {
  const url = parseUrl(value);

  if (url?.origin === PRODUCTION_ORIGIN) {
    if (isDesktopInstallerUrl(url)) return "open-external";
    return "allow-in-app";
  }

  if (url?.protocol === "https:") {
    return "open-external";
  }

  return "deny";
}

function isDesktopInstallerUrl(url) {
  if (url.search || url.hash) return false;
  const match = /^\/desktop\/releases\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\/Fields-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-Setup\.exe$/u.exec(url.pathname);
  if (!match) return false;
  return match[1] === match[4] && match[2] === match[5] && match[3] === match[6];
}

module.exports = {
  PRODUCTION_ORIGIN,
  navigationAction,
};
