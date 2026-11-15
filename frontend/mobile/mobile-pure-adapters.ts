export function normalizedImageFileName(name: string, mimeType: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._ -]/gu, "_").trim();
  const base = (cleaned.replace(/\.[^.]*$/u, "").trim() || "image").slice(0, 170);
  const extension = mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : "";
  if (!extension) throw new Error("image_mime_type_unsupported");
  return `${base}${extension}`;
}

export function notificationMarkReadInput(target: { kind: "home" | "room"; id: string; through: string }) {
  return {
    target: target.kind === "home" ? { kind: "home" as const, thread_id: target.id } : { kind: "room" as const, room_id: target.id },
    through: target.through,
  };
}
