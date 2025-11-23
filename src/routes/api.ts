import express from "express";
import { ClientManager } from "../core/ClientManager.js";
import { Client } from "../core/Client.js"; // Import Client type
import { pendingRequests, PENDING_REQUEST_TYPES, PendingRequestType, safeResponse } from './shared.js';
import { log } from '../utils/logger.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSearchTools } from './api/search.js';
import { registerChatMsgTools } from './api/chatMsg.js';

export const VERSION = '2.0.13';

export const apiRoutes = (app: express.Application, server: McpServer): void => {
    const REQUEST_TYPES_WITH_SPECIAL_RESPONSE_HANDLERS = [
        'actor-sheet', 'download-file'
    ] as const;

    // Setup handlers for storing search results and entity data from WebSocket
    setupMessageHandlers();

    registerSearchTools(server);
    registerChatMsgTools(server);


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
