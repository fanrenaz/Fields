import type { ComponentProps, ReactNode } from "react";
import { useRef } from "react";
import { Button } from "@lobehub/ui/base-ui";

import { DIRECT_UPLOAD_MAX_FILE_BYTES, type PickedFile } from "../../types/upload";

type FilePickButtonProps = Readonly<Omit<ComponentProps<typeof Button>, "onClick"> & {
  accept?: string;
  children?: ReactNode;
  inputId?: string;
  multiple?: boolean;
  maxFileSizeBytes?: number;
  onFilesPicked: (files: PickedFile[]) => void;
  onFilesRejected?: (files: PickedFile[]) => void;
}>;

export function FilePickButton({
  accept,
  children,
  inputId,
  multiple = true,
  maxFileSizeBytes = DIRECT_UPLOAD_MAX_FILE_BYTES,
  onFilesPicked,
  onFilesRejected,
  ...buttonProps
}: FilePickButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        accept={accept}
        id={inputId}
        ref={inputRef}
        type="file"
        multiple={multiple}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []).map((file) => ({
            file,
            name: file.name,
            size: file.size,
            type: file.type,
          }));
          const acceptedFiles = files.filter((file) => file.size <= maxFileSizeBytes);
          const rejectedFiles = files.filter((file) => file.size > maxFileSizeBytes);

          if (acceptedFiles.length > 0) {
            onFilesPicked(acceptedFiles);
          }
          if (rejectedFiles.length > 0) {
            onFilesRejected?.(rejectedFiles);
          }
          event.target.value = "";
        }}
        style={{ display: "none" }}
      />
      <Button {...buttonProps} onClick={() => inputRef.current?.click()}>
        {children}
      </Button>
    </>
  );
}
