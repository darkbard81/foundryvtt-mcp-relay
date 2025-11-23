import { z } from 'zod';

export const FIX_outputArgs = {
  clientId: z.string().optional(),
  requestId: z.string().optional(),
  error: z.string().optional(),
  data: z.any().optional()
};

export const baseArgs = {
  clientId: z.string(),
};

export function formatToolError(err: unknown, clientId: string) {
  const message =
    err instanceof Error
      ? err.message
      : (typeof err === 'object' && err && 'error' in err)
        ? String((err as any).error)
        : 'Unknown error while processing request';

  const structured =
    typeof err === 'object' && err !== null
      ? { ...(err as Record<string, any>) }
      : {};

  if (!structured.error) structured.error = message;
  if (!structured.clientId) structured.clientId = clientId;
  if (!structured.requestId) structured.requestId = structured.requestId ?? 'unknown';

  return {
    content: [{
      type: 'text' as const,
      text: `Failed to process request for client ${clientId}: ${message}`,
    }],
    structuredContent: structured,
  };
}
