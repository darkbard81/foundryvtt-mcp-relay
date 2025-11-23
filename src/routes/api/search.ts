import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { baseArgs, FIX_outputArgs, formatToolError } from './common.js';
import { sendClientRequest } from '../route-helpers.js';

export function registerSearchTools(server: McpServer): void {
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
                };

                return {
                    content: [{ type: 'text', text: 'Success' }],
                    structuredContent: output
                };
            } catch (err) {
                return formatToolError(err, clientId);
            }
        },
    );
}
