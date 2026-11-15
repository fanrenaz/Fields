import type {
  RoomMessageImageAttachment,
  RoomReferenceTarget,
} from "@fields/contracts/public/room";

export function referencesWithRoomImageAttachments(input: {
  roomId: string;
  references: readonly RoomReferenceTarget[];
  imageAttachments: readonly RoomMessageImageAttachment[];
}): RoomReferenceTarget[] {
  const references = [...input.references];
  const fileVersions = new Set(references.flatMap((reference) => (
    reference.type === "file" ? [`${reference.id}\0${reference.version_id}`] : []
  )));
  for (const attachment of input.imageAttachments) {
    const key = `${attachment.file_id}\0${attachment.version_id}`;
    if (fileVersions.has(key)) continue;
    references.push({
      type: "file",
      id: attachment.file_id,
      version_id: attachment.version_id,
      room_id: input.roomId,
    });
    fileVersions.add(key);
  }
  return references;
}
