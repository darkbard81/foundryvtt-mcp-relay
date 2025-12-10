import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { baseArgs, FIX_outputArgs, formatToolError } from './common.js';
import { sendClientRequest } from '../route-helpers.js';
import { createImageGen } from '../../utils/assetGenerator.js';
import { z } from 'zod';
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function registerRelaySelfTools(server: McpServer): void {

    const imageArgs = {
        imageprompt: z.string()
    };

    const here = path.dirname(fileURLToPath(import.meta.url));
    const HTML = readFileSync(path.join(here, "kanban.js"), "utf8");
    const CSS = readFileSync(path.join(here, "kanban.css"), "utf8");

    server.registerResource(
        "kanban-widget",
        "ui://widget/kanban-board.html",
        {},
        async () => ({
            contents: [
                {
                    uri: "ui://widget/kanban-board.html",
                    mimeType: "text/html+skybridge",
                    text: `<div id="kanban-root"></div>
                           <style>${CSS}</style>
                           <script type="module">${HTML}</script>`.trim(),
                    _meta: {
                        "openai/widgetPrefersBorder": true,
                        "openai/widgetDomain": "https://mcp.krdp.ddns.net",
                        "openai/widgetDescription": "Shows an interactive generation Image",
                        "openai/widgetCSP": {
                            connect_domains: ["https://mcp.krdp.ddns.net"], // example API domain
                            resource_domains: ["https://mcp.krdp.ddns.net"], // example CDN allowlist
                        },
                    },
                },
            ],
        })
    );

    server.registerTool(
        'generate-image',
        {
            title: 'Generate Image',
            description: 'Create an image using the relay-side generator and return its URL',
            inputSchema: imageArgs,
            outputSchema: FIX_outputArgs,
            _meta: {
                "openai/outputTemplate": "ui://widget/kanban-board.html",
                "openai/widgetAccessible": true,
                "openai/toolInvocation/invoking": "Preparing the board…",
                "openai/toolInvocation/invoked": "Board ready.",
            },
            annotations: {
                title: 'Safe Generate Image',
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true
            }
        },
        async (args) => {
            const { imageprompt } = args;
            const payload: Record<string, any> = {};
            let imageUrl: string = '';

            try {
                if (imageprompt) {
                    imageUrl = await createImageGen(imageprompt, 1, true);
                }

                const output = {
                    clientId: 'RelaySelf(No clientID)',
                    requestId: 'RelaySelf(No RequestID)',
                    data: JSON.stringify({ url: imageUrl })
                };

                return {
                    content: [{ type: 'text', text: 'Success' }],
                    structuredContent: output
                };
            } catch (err) {
                return formatToolError(err, 'None');
            }
        },
    );
};
