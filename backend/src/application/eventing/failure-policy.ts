import { isApplicationError } from "../platform/errors.js";

import type { EventDeliveryFailure } from "./ports/index.js";

export const EVENT_UNKNOWN_DELIVERY_FAILURE_CODE = "EVENT_DELIVERY_FAILED";
export const EVENT_CODEC_UNAVAILABLE_FAILURE_CODE = "EVENT_CODEC_UNAVAILABLE";
export const EVENT_CODEC_INVALID_FAILURE_CODE = "EVENT_CODEC_INVALID";
export const EVENT_HANDLER_UNAVAILABLE_FAILURE_CODE = "EVENT_HANDLER_UNAVAILABLE";

const SAFE_APPLICATION_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Converts thrown values into the only error shape durable Event storage may
 * retain. Raw Error messages and causes never cross this boundary.
 */
export function toEventDeliveryFailure(error: unknown): EventDeliveryFailure {
  if (isApplicationError(error) && SAFE_APPLICATION_ERROR_CODE.test(error.code)) {
    return {
      code: error.code,
      retryable: error.retryable,
    };
  }

  return {
    code: EVENT_UNKNOWN_DELIVERY_FAILURE_CODE,
    retryable: true,
  };
}
