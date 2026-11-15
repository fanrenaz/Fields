import type {
  RoomSideChatReadResult,
} from "@fields/contracts/public/room-side-chat";
import type { HomeTurnSubmitResult } from "@fields/contracts/public/home";

export interface RoomSideChatApplication {
  read(
    companyId: string,
    humanMemberId: string,
    roomId: string,
  ): Promise<RoomSideChatReadResult>;
  submitTurn(input: {
    companyId: string;
    humanMemberId: string;
    roomId: string;
    prompt: string;
    clientMessageId?: string;
    timeoutMs?: number;
  }): Promise<{ room_id: string; turn: HomeTurnSubmitResult }>;
  threadIds(companyId: string, humanMemberId: string): Promise<Set<string>>;
}
