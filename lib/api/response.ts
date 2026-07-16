import { NextResponse } from "next/server";

import { redactProviderError } from "./provider-error";

export type ApiResponsePayload = {
  success: boolean;
  data: unknown;
  trace: unknown;
  fallbackUsed: boolean;
  fallbackReason?: string | null;
  error?: string | null;
};

export function sanitizeApiError(error: unknown): string {
  return redactProviderError(error);
}


export function apiJson(input: ApiResponsePayload, status = 200) {
  return NextResponse.json(
    {
      success: input.success,
      data: input.data,
      trace: input.trace,
      fallbackUsed: input.fallbackUsed,
      fallbackReason: input.fallbackReason ? sanitizeApiError(input.fallbackReason) : null,
      error: input.error ? sanitizeApiError(input.error) : null
    },
    { status }
  );
}


