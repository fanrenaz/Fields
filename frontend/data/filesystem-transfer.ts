import type { ZodType } from "zod";

import type { PickedFile } from "../shared/types/upload";

const MAX_UPLOAD_CONCURRENCY = 3;

export type FilesystemUploadBatchResult<T> = {
  uploaded: T[];
  failed: string[];
};

export async function uploadFilesystemFiles<T>(input: {
  endpoint: string;
  query: Record<string, string>;
  files: PickedFile[];
  resultSchema: ZodType<T>;
}): Promise<FilesystemUploadBatchResult<T>> {
  const uploaded: T[] = [];
  const failed: string[] = [];
  let index = 0;
  const worker = async () => {
    while (index < input.files.length) {
      const file = input.files[index++]!;
      const query = new URLSearchParams({ ...input.query, name: file.name });
      try {
        const response = await fetch(`${input.endpoint}?${query}`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/octet-stream" },
          body: file.file,
        });
        if (!response.ok) throw new Error("filesystem_upload_failed");
        uploaded.push(input.resultSchema.parse(await response.json()));
      } catch {
        failed.push(file.name);
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_UPLOAD_CONCURRENCY, input.files.length) },
      () => worker(),
    ),
  );
  return { uploaded, failed };
}

export function downloadFilesystemFile(
  endpoint: string,
  query: Record<string, string>,
): void {
  const anchor = document.createElement("a");
  anchor.href = `${endpoint}?${new URLSearchParams(query)}`;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
