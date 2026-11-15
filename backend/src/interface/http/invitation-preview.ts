import type { IncomingHttpHeaders } from "node:http";

import {
  HumanInvitationAdmissionError,
  type HumanInvitationAdmissionPolicyUseCase,
  type HumanInvitationPreview,
} from "../../application/actor/index.js";

export const FIELDS_INVITATION_ID_HEADER = "X-Fields-Invitation-Id";
export const FIELDS_REGISTRATION_CREDENTIAL_HEADER = "X-Fields-Registration-Credential";

export type InvitationPreviewHttpOutput =
  | {
    statusCode: 200;
    body: HumanInvitationPreview;
  }
  | {
    statusCode: 403 | 500;
    body: {
      code: string;
      message: string;
    };
  };

/**
 * Resolve the public invitation preview without allowing its bearer credential,
 * invitation email, membership details, or persistence errors into the response.
 */
export async function resolveInvitationPreviewHttpRequest(
  policy: HumanInvitationAdmissionPolicyUseCase,
  headers: IncomingHttpHeaders,
): Promise<InvitationPreviewHttpOutput> {
  try {
    const credential = singleInvitationCredential(
      headers[FIELDS_INVITATION_ID_HEADER.toLowerCase()],
    );
    return {
      statusCode: 200,
      body: await policy.previewInvitation(credential),
    };
  } catch (error) {
    if (
      error instanceof HumanInvitationAdmissionError
      && error.failure !== "unavailable"
    ) {
      return {
        statusCode: 403,
        body: invalidInvitationBody(),
      };
    }
    return {
      statusCode: 500,
      body: {
        code: "FIELDS_INVITATION_PREVIEW_UNAVAILABLE",
        message: "Invitation preview is temporarily unavailable.",
      },
    };
  }
}

function singleInvitationCredential(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function invalidInvitationBody(): { code: string; message: string } {
  return {
    code: "FIELDS_INVITATION_INVALID",
    message: "A valid pending Fields invitation is required.",
  };
}
