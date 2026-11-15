const fs = require("node:fs");
const path = require("node:path");

const frontendRoot = path.resolve(__dirname, "..");
const defaultOutputDirectory = path.join(frontendRoot, "artifacts", "pwa");
const requestedOutputDirectory = process.env.FIELDS_PWA_OUTPUT_DIR;
const outputDirectory = requestedOutputDirectory || defaultOutputDirectory;

async function main() {
  if (requestedOutputDirectory) {
    if (
      !path.isAbsolute(requestedOutputDirectory)
      || path.normalize(requestedOutputDirectory) !== requestedOutputDirectory
      || fs.existsSync(requestedOutputDirectory)
    ) {
      throw new Error("FIELDS_PWA_OUTPUT_DIR must be an absolute, normalized, non-existing directory.");
    }
    const parent = path.dirname(requestedOutputDirectory);
    if (fs.realpathSync(parent) !== parent || fs.lstatSync(parent).isSymbolicLink()) {
      throw new Error("FIELDS_PWA_OUTPUT_DIR must have a real, non-symlink parent directory.");
    }
  } else {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
  Object.assign(process.env, {
    VITE_FIELDS_BACKEND_TRPC_URL: "/api/v1/trpc",
  });
  const { build } = await import("vite");
  await build({
    root: frontendRoot,
    mode: "pwa",
    build: {
      emptyOutDir: false,
      outDir: outputDirectory,
    },
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
