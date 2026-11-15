import type {
  AgentBuilderProfile,
  AgentBuilderTopic,
} from "@fields/contracts/public/agent-builder";
import type { HomeThreadReadResult, HomeTurnSubmitResult } from "@fields/contracts/public/home";

export interface AgentBuilderApplication {
  profile(companyId: string, humanMemberId: string, agentMemberId: string): Promise<AgentBuilderProfile>;
  updateProfile(input: {
    companyId: string;
    humanMemberId: string;
    agentMemberId: string;
    description: string;
    avatar: string;
    instructions: string;
    readiness: "draft" | "ready";
    memoryEnabled: boolean;
    expectedRevision: number;
  }): Promise<AgentBuilderProfile>;
  listTopics(companyId: string, humanMemberId: string, agentMemberId: string): Promise<AgentBuilderTopic[]>;
  createTopic(companyId: string, humanMemberId: string, agentMemberId: string, title?: string): Promise<AgentBuilderTopic>;
  readTopic(companyId: string, humanMemberId: string, agentMemberId: string, topicId: string): Promise<{
    topic: AgentBuilderTopic;
    thread: HomeThreadReadResult | null;
  }>;
  submitTurn(input: {
    companyId: string;
    humanMemberId: string;
    agentMemberId: string;
    topicId: string;
    prompt: string;
    clientMessageId?: string;
    timeoutMs?: number;
  }): Promise<{
    topic: AgentBuilderTopic;
    turn: HomeTurnSubmitResult;
    profile: AgentBuilderProfile;
  }>;
  threadIds(companyId: string, humanMemberId: string): Promise<Set<string>>;
  requireRoomReady(companyId: string, memberId: string): Promise<void>;
}
