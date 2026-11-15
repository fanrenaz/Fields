import type {
  AssetBuilderTarget,
  AssetBuilderTopic,
} from "@fields/contracts/public/asset-builder";
import type { HomeThreadReadResult, HomeTurnSubmitResult } from "@fields/contracts/public/home";

export interface AssetBuilderApplication {
  listTopics(
    companyId: string,
    humanMemberId: string,
    target: AssetBuilderTarget,
  ): Promise<AssetBuilderTopic[]>;
  createTopic(
    companyId: string,
    humanMemberId: string,
    target: AssetBuilderTarget,
    title?: string,
  ): Promise<AssetBuilderTopic>;
  readTopic(
    companyId: string,
    humanMemberId: string,
    topicId: string,
  ): Promise<{ topic: AssetBuilderTopic; thread: HomeThreadReadResult | null }>;
  submitTurn(input: {
    companyId: string;
    humanMemberId: string;
    topicId: string;
    prompt: string;
    clientMessageId?: string;
    timeoutMs?: number;
  }): Promise<{ topic: AssetBuilderTopic; turn: HomeTurnSubmitResult }>;
  threadIds(companyId: string, humanMemberId: string): Promise<Set<string>>;
}
