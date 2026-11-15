import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export type CompanyAssetObjectStoreConfig = {
  companyId: string;
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export interface CompanyAssetObjectStore {
  has(contentSha256: string): Promise<boolean>;
  putIfAbsent(contentSha256: string, archive: Uint8Array): Promise<void>;
  get(contentSha256: string): Promise<Uint8Array>;
}

export class S3CompanyAssetObjectStore implements CompanyAssetObjectStore {
  private readonly client: S3Client;

  constructor(private readonly config: CompanyAssetObjectStoreConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async has(contentSha256: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(contentSha256),
      }));
      return true;
    } catch (error) {
      if (statusCode(error) === 404) return false;
      throw error;
    }
  }

  async putIfAbsent(contentSha256: string, archive: Uint8Array): Promise<void> {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(contentSha256),
        Body: archive,
        ContentType: "application/zip",
        IfNoneMatch: "*",
        Metadata: {
          content_sha256: contentSha256,
        },
      }));
    } catch (error) {
      if (statusCode(error) !== 412) throw error;
    }
  }

  async get(contentSha256: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: this.key(contentSha256),
    }));
    if (!response.Body) throw new Error("Company Asset package body is unavailable.");
    return response.Body.transformToByteArray();
  }

  private key(contentSha256: string): string {
    if (!/^[0-9a-f]{64}$/u.test(contentSha256)) {
      throw new Error("Company Asset content digest is invalid.");
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(this.config.companyId)) {
      throw new Error("Company ID cannot be represented in an object key.");
    }
    return `companies/${this.config.companyId}/packages/${contentSha256}.zip`;
  }
}

export function companyAssetObjectStoreConfigFromEnv(
  companyId: string,
  input: NodeJS.ProcessEnv = process.env,
): CompanyAssetObjectStoreConfig {
  return {
    companyId,
    bucket: input.FIELDS_COMPANY_ASSETS_BUCKET ?? "fields-company-assets",
    endpoint: input.FIELDS_OBJECT_STORAGE_INTERNAL_ENDPOINT ?? "http://127.0.0.1:9000",
    region: input.FIELDS_OBJECT_STORAGE_REGION ?? "us-east-1",
    accessKeyId: input.FIELDS_COMPANY_ASSETS_ACCESS_KEY_ID ?? "fields-dev-assets",
    secretAccessKey: input.FIELDS_COMPANY_ASSETS_SECRET_ACCESS_KEY ?? "fields-dev-assets-secret",
  };
}

function statusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return null;
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : null;
}
