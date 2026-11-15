export const DIRECT_UPLOAD_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const DIRECT_UPLOAD_MAX_FILE_LABEL = "25 MB";

export type PickedFile = {
  file: File;
  name: string;
  size: number;
  type?: string;
};

export function directUploadLimitMessage(files: PickedFile[]) {
  if (files.length === 1) {
    return `${files[0].name} is larger than ${DIRECT_UPLOAD_MAX_FILE_LABEL}. Add it as an External source instead.`;
  }

  return `${files.length} files are larger than ${DIRECT_UPLOAD_MAX_FILE_LABEL}. Add them as External sources instead.`;
}
