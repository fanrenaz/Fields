import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import type { CompanyFileObjectStore } from "../../application/company/ports/company-files.js";

export type CompanyFileObjectStoreConfig = {
  bucket: string;
  internalEndpoint: string;
  publicEndpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export class S3CompanyFileObjectStore implements CompanyFileObjectStore {
  private readonly internal: S3Client;
  private readonly public: S3Client;

  constructor(private readonly config: CompanyFileObjectStoreConfig) {
    const credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
    this.internal = new S3Client({
      region: config.region,
      endpoint: config.internalEndpoint,
      credentials,
      forcePathStyle: true,
    });
    this.public = new S3Client({
      region: config.region,
      endpoint: config.publicEndpoint,
      credentials,
      forcePathStyle: true,
    });
  }

  objectKey(companyId: string, sha256: string): string {
    return `companies/${safeSegment(companyId)}/blobs/${sha256}`;
  }

  async head(key: string): Promise<{ sizeBytes: number; sha256: string } | null> {
    try {
      const result = await this.internal.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }));
      return {
        sizeBytes: result.ContentLength ?? 0,
        sha256: result.Metadata?.sha256 ?? "",
      };
    } catch (error) {
      if (objectErrorStatus(error) === 404) return null;
      throw error;
    }
  }

  presignPut(input: {
    audience: "browser" | "runtime";
    key: string;
    contentType: string;
    sha256: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(input.audience === "runtime" ? this.internal : this.public, new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ContentType: input.contentType,
      Metadata: { sha256: input.sha256 },
    }), { expiresIn: input.expiresInSeconds });
  }

  presignGet(input: {
    audience: "browser" | "runtime";
    key: string;
    downloadName: string;
    contentType: string;
    expiresInSeconds: number;
    disposition?: "attachment" | "inline";
  }): Promise<string> {
    return getSignedUrl(input.audience === "runtime" ? this.internal : this.public, new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ResponseContentType: input.contentType,
      ResponseContentDisposition: `${input.disposition ?? "attachment"}; filename*=UTF-8''${encodeURIComponent(input.downloadName)}`,
    }), { expiresIn: input.expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }));
  }
}

export function companyFileObjectStoreConfigFromEnv(
  input: NodeJS.ProcessEnv = process.env,
): CompanyFileObjectStoreConfig {
  return {
    bucket: input.FIELDS_COMPANY_FILES_BUCKET ?? "fields-company-files",
    internalEndpoint: input.FIELDS_OBJECT_STORAGE_INTERNAL_ENDPOINT ?? "http://127.0.0.1:9000",
    publicEndpoint: input.FIELDS_OBJECT_STORAGE_PUBLIC_ENDPOINT ?? "http://127.0.0.1:9000",
    region: input.FIELDS_OBJECT_STORAGE_REGION ?? "us-east-1",
    accessKeyId: input.FIELDS_COMPANY_FILES_ACCESS_KEY_ID ?? "fields-dev-files",
    secretAccessKey: input.FIELDS_COMPANY_FILES_SECRET_ACCESS_KEY ?? "fields-dev-files-secret",
  };
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new Error("Company ID cannot be represented in an object key.");
  }
  return value;
}

function objectErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return null;
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : null;
}
