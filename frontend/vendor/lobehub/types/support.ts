export type ErrorType = string | number;
export type ILobeAgentRuntimeErrorType = string | number;
export type IToolErrorType = string | number;
export type LobeToolRenderType = string;
export type ThreadStatus = string;

export type GroundingSearch = Record<string, unknown>;
export type WorkSummaryItem = Record<string, unknown>;
export type MessageMetadata = Record<string, any>;

export type ModelPerformance = {
  duration?: number;
  latency?: number;
  tps?: number;
  ttft?: number;
};

export type ModelUsage = {
  [key: string]: number | undefined;
  cost?: number;
};

export type ChatImageItem = Record<string, unknown>;
export type ChatAudioItem = Record<string, unknown>;
export type ChatFileChunk = Record<string, unknown>;
export type ChatMessageExtra = Record<string, unknown>;
export type ChatVideoItem = Record<string, unknown>;
