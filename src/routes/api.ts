import express from "express";
import { ClientManager } from "../core/ClientManager.js";
import { Client } from "../core/Client.js"; // Import Client type
import { pendingRequests, PENDING_REQUEST_TYPES, PendingRequestType, safeResponse } from './shared.js';
import { log } from '../utils/logger.js';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sendClientRequest } from './route-helpers.js';
import { createAudioTTS } from '../utils/audioTTS.js';
import { VoiceActor, StyleTone } from '../utils/audioTTS.js';

export const VERSION = '2.0.13';

export const FIX_outputArgs = {
    clientId: z.string().optional(),
    requestId: z.string().optional(),
    error: z.string().optional(),
    data: z.any().optional()
};

function formatToolError(err: unknown, clientId: string) {
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

export const apiRoutes = (app: express.Application, server: McpServer): void => {
    const REQUEST_TYPES_WITH_SPECIAL_RESPONSE_HANDLERS = [
        'actor-sheet', 'download-file'
    ] as const;

    // Setup handlers for storing search results and entity data from WebSocket
    setupMessageHandlers();

    const baseArgs = {
        clientId: z.string(),
    };

    const addArrayArgs = {
        ...baseArgs,
        limit: z.number().int().positive().max(100).default(5).optional(),
    };

    const chatArrayArgs = {
        ...baseArgs,
        message: z.string(),
        audioTTS: z.boolean().optional().default(false),
        temperature: z.number().min(0).max(2).optional().default(1),
        styleTone: z.nativeEnum(StyleTone).optional().default(StyleTone.Narration),
        voiceActor: z.nativeEnum(VoiceActor).optional().default(VoiceActor.Achernar),
    };

    server.registerTool(
        'rolls',
        {
            title: 'Get Dice Log History',
            description: 'Fetch the recent dice log entries for a Foundry client',
            inputSchema: addArrayArgs,
            outputSchema: FIX_outputArgs,
            annotations: {
                title: 'Safe logMessage',
                readOnlyHint: true,
                destructiveHint: false, // 기본값은 true라서 함께 명시해 줘도 좋습니다
                idempotentHint: true    // 같은 입력 반복 호출해도 영향 없음을 표시
            }
        },
        async (addArrayArgs) => {
            const payload: Record<string, any> = {};
            const { clientId, limit } = addArrayArgs;
            if (typeof limit === 'number') {
                payload.limit = limit;
            }

            try {
                const response = await sendClientRequest({
                    type: 'rolls',
                    clientId,
                    payload,
                });

                const output = {
                    clientId: response.clientId,
                    requestId: response.requestId,
                    data: response.data
                }

                return {
                    content: [{ type: 'text', text: 'Success' }],
                    structuredContent: output
                };
            } catch (err) {
                return formatToolError(err, clientId);
            };
        },
    );

    server.registerTool(
        'chat-logs',
        {
            title: 'Get Chat Log History',
            description: 'Fetch the recent chat log entries for a Foundry client',
            inputSchema: addArrayArgs,
            outputSchema: FIX_outputArgs,
            annotations: {
                title: 'Safe logMessage',
                readOnlyHint: true,
                destructiveHint: false, // 기본값은 true라서 함께 명시해 줘도 좋습니다
                idempotentHint: true    // 같은 입력 반복 호출해도 영향 없음을 표시
            }
        },
        async (addArrayArgs) => {
            const payload: Record<string, any> = {};
            const { clientId, limit } = addArrayArgs;
            if (typeof limit === 'number') {
                payload.limit = limit;
            }

            try {
                const response = await sendClientRequest({
                    type: 'chat-logs',
                    clientId,
                    payload,
                });

                const output = {
                    clientId: response.clientId,
                    requestId: response.requestId,
                    data: response.data
                }

                return {
                    content: [{ type: 'text', text: 'Success' }],
                    structuredContent: output
                };
            } catch (err) {
                return formatToolError(err, clientId);
            };
        },
    )

    server.registerTool(
        'chat-message',
        {
            title: 'Send Chat Message',
            description: 'Send Chat Message for a Foundry client',
            inputSchema: chatArrayArgs,
            outputSchema: FIX_outputArgs,
            annotations: {
                title: 'Safe logMessage',
                readOnlyHint: true,
                destructiveHint: false, // 기본값은 true라서 함께 명시해 줘도 좋습니다
                idempotentHint: true    // 같은 입력 반복 호출해도 영향 없음을 표시
            }
        },
        async (chatArrayArgs) => {
            const payload: Record<string, any> = {};
            const { clientId, message, audioTTS, temperature, styleTone, voiceActor } = chatArrayArgs;
            if (typeof message === 'string') {
                payload.message = message;
            }
            if (typeof audioTTS === 'boolean' && audioTTS === true) {
                payload.audioPath = await createAudioTTS(message, temperature, styleTone, voiceActor);
            }
            try {
                const response = await sendClientRequest({
                    type: 'chat-message',
                    clientId,
                    payload,
                });

                const output = {
                    clientId: response.clientId,
                    requestId: response.requestId,
                    data: response.data
                }

                return {
                    content: [{ type: 'text', text: 'Success' }],
                    structuredContent: output
                };
            } catch (err) {
                return formatToolError(err, clientId);
            };
        },
    );

    server.registerTool(
        'search-tokens',
        {
            title: 'Get Tokens Info current Scene',
            description: 'Fetch the current Token entries for a Foundry client',
            inputSchema: baseArgs,
            outputSchema: FIX_outputArgs,
            annotations: {
                title: 'Safe Token Info',
                readOnlyHint: true,
                destructiveHint: false, // 기본값은 true라서 함께 명시해 줘도 좋습니다
                idempotentHint: true    // 같은 입력 반복 호출해도 영향 없음을 표시
            }
        },
        async (addArrayArgs) => {
            const payload: Record<string, any> = {};
            const { clientId } = addArrayArgs;

            try {
                const response = await sendClientRequest({
                    type: 'search-tokens',
                    clientId,
                    payload,
                });

                const output = {
                    clientId: response.clientId,
                    requestId: response.requestId,
                    data: response.data
                }

                return {
                    content: [{ type: 'text', text: 'Success' }],
                    structuredContent: output
                };
            } catch (err) {
                return formatToolError(err, clientId);
            };
        },
    )



    // Setup WebSocket message handlers to route responses back to API requests
    function setupMessageHandlers() {

        for (const type of PENDING_REQUEST_TYPES) {
            if (REQUEST_TYPES_WITH_SPECIAL_RESPONSE_HANDLERS.includes(type as (typeof REQUEST_TYPES_WITH_SPECIAL_RESPONSE_HANDLERS)[number])) {
                continue;
            }

            ClientManager.onMessageType(`${type}-result`, (client: Client, data: any) => {
                log.info(`Received ${type} response for requestId: ${data.requestId}`);

                if (data.requestId && pendingRequests.has(data.requestId)) {
                    const pending = pendingRequests.get(data.requestId);
                    if (!pending) {
                        log.warn(`Pending request ${data.requestId} was deleted before processing`);
                        return;
                    }

                    const response: Record<string, any> = {
                        requestId: data.requestId,
                        clientId: pending.clientId || client.getId()
                    };
                    for (const [key, value] of Object.entries(data)) {
                        if (key !== 'requestId') {
                            response[key] = value;
                        }
                    }
                    if (pending.res) {
                        if (response.error) {
                            safeResponse(pending.res, 400, response);
                        } else {
                            safeResponse(pending.res, 200, response);
                        }
                    } else if (response.error) {
                        pending.reject?.(response);
                    } else {
                        pending.resolve?.(response);
                    }
                    pendingRequests.delete(data.requestId);
                    return;
                }
            });
        }

        // Handler for file download result
        ClientManager.onMessageType("download-file-result", (client: Client, data: any) => {
            log.info(`Received file download result for requestId: ${data.requestId}`);

            if (data.requestId && pendingRequests.has(data.requestId)) {
                const request = pendingRequests.get(data.requestId)!;
                pendingRequests.delete(data.requestId);

                if (!request.res) {
                    if (data.error) {
                        request.reject?.(data);
                    } else {
                        request.resolve?.(data);
                    }
                    return;
                }

                if (data.error) {
                    safeResponse(request.res, 500, {
                        clientId: client.getId(),
                        requestId: data.requestId,
                        error: data.error
                    });
                    return;
                }

                // Check if the client wants raw binary data or JSON response
                const format = request.format || 'binary'; // Default to binary format

                if (format === 'binary' || format === 'raw') {
                    // Extract the base64 data and send as binary
                    const base64Data = data.fileData.split(',')[1];
                    const buffer = Buffer.from(base64Data, 'base64');

                    // Set the appropriate content type
                    request.res.setHeader('Content-Type', data.mimeType || 'application/octet-stream');
                    request.res.setHeader('Content-Disposition', `attachment; filename="${data.filename}"`);
                    request.res.setHeader('Content-Length', buffer.length);

                    // Send the binary data
                    request.res.status(200).end(buffer);
                } else {
                    // Send JSON response with the file data
                    safeResponse(request.res, 200, {
                        clientId: client.getId(),
                        requestId: data.requestId,
                        success: true,
                        path: data.path,
                        filename: data.filename,
                        mimeType: data.mimeType,
                        fileData: data.fileData,
                        size: Buffer.from(data.fileData.split(',')[1], 'base64').length
                    });
                }
            }
        });

        // Clean up old pending requests periodically
        setInterval(() => {
            const now = Date.now();
            for (const [requestId, request] of pendingRequests.entries()) {
                // Remove requests older than 30 seconds
                if (now - request.timestamp > 30000) {
                    log.warn(`Request ${requestId} timed out and was never completed`);
                    pendingRequests.delete(requestId);
                }
            }
        }, 10000);
    }

}
