import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ASSET_ZIP_MAX_BYTES = 25 * 1024 * 1024;

export type SpooledPackage = {
  directory: string;
  path: string;
  sha256: string;
  sizeBytes: number;
};

export async function spoolAssetPackage(
  body: AsyncIterable<unknown>,
  temporaryRoot: string = tmpdir(),
): Promise<SpooledPackage> {
  const directory = await mkdtemp(join(temporaryRoot, "fields-asset-upload-"));
  const path = join(directory, "package.zip");
  const handle = await open(path, "wx", 0o600).catch(async (error) => {
    await rm(directory, { recursive: true, force: true });
    throw error;
  });
  const digest = createHash("sha256");
  let total = 0;
  try {
    for await (const value of body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      total += chunk.byteLength;
      if (total > ASSET_ZIP_MAX_BYTES) throw new AssetPackageTooLargeError();
      digest.update(chunk);
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  await handle.close();
  if (total === 0) {
    await rm(directory, { recursive: true, force: true });
    throw new Error("asset_package_empty");
  }
  return {
    directory,
    path,
    sha256: digest.digest("hex"),
    sizeBytes: total,
  };
}

export class AssetPackageTooLargeError extends Error {}
