const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const packageJson = require(path.join(desktopRoot, "package.json"));
const outputDirectory = path.join(desktopRoot, "artifacts", "renderer");

async function main() {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  Object.assign(process.env, {
    VITE_FIELDS_BACKEND_TRPC_URL: "/api/v1/trpc",
    VITE_FIELDS_DESKTOP_VERSION: packageJson.version,
  });

  const { build } = await import("vite");
  await build({
    root: desktopRoot,
    mode: "desktop",
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
