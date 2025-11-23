import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createAudioTTS } from '../../utils/audioTTS.js';
import { VoiceActor, StyleTone } from '../../utils/audioTTS.js';
import { baseArgs, FIX_outputArgs, formatToolError } from './common.js';
import { sendClientRequest } from '../route-helpers.js';
import { z } from 'zod';

export function registerChatMsgTools(server: McpServer): void {
    const logArrayArgs = {
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

    const bubbleArrayArgs = {
        ...baseArgs,
        bubbles: z.array(z.object({
            tokenId: z.string(),
            message: z.string(),
            asyncDelay: z.number().int().nonnegative().optional().default(0),
        })).nonempty()
    };

    server.registerTool(
        'chat-logs',
        {
            title: 'Get Chat Log History',
            description: 'Fetch the recent chat log entries for a Foundry client',
            inputSchema: logArrayArgs,
            outputSchema: FIX_outputArgs,
            annotations: {
                title: 'Safe logMessage',
                readOnlyHint: true,
                destructiveHint: false, // 기본값은 true라서 함께 명시해 줘도 좋습니다
                idempotentHint: true    // 같은 입력 반복 호출해도 영향 없음을 표시
            }
        },
        async (logArrayArgs) => {
            const payload: Record<string, any> = {};
            const { clientId, limit } = logArrayArgs;
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
        'chat-bubbles',
        {
            title: 'Send Chat Bubbles',
            description: 'Show chat bubbles on tokens with optional per-item delay.',
            inputSchema: bubbleArrayArgs,
            outputSchema: FIX_outputArgs,
            annotations: {
                title: 'Safe chat bubbles',
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: false
            }
        },
        async (bubbleArgs) => {
            const { clientId, bubbles } = bubbleArgs;
            const payload = { data: bubbles };

            try {
                const response = await sendClientRequest({
                    type: 'chat-bubbles',
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
}
