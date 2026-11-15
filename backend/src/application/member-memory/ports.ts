import type { HomeMemoryProfile } from "@fields/contracts/public/home";

export interface MemberMemoryApplication {
  profile(companyId: string, memberId: string): Promise<HomeMemoryProfile>;
  update(input: {
    companyId: string;
    memberId: string;
    enabled: boolean;
    expectedRevision: number;
  }): Promise<HomeMemoryProfile>;
  complete(input: {
    companyId: string;
    memberId: string;
    operationId: string;
    appliedEnabled: boolean;
    status: "ready" | "failed";
    errorCode: string | null;
    completedAtMs: number;
  }): Promise<void>;
}
