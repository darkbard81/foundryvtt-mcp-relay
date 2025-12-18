import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { baseArgs, FIX_outputArgs, formatToolError } from './common.js';
import { sendClientRequest } from '../route-helpers.js';
import { createImageGen, AspectRatio } from '../../utils/assetGenerator.js';
import { z } from 'zod';
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { widgetAvHub } from "../../core/WidgetAvHub.js";


export function registerRelaySelfTools(server: McpServer): void {

    const imageArgs = {
        imageprompt: z.string(),
        aspectRatio: z.nativeEnum(AspectRatio).optional().default(AspectRatio.R2_3)
    };

    const here = path.dirname(fileURLToPath(import.meta.url));
    const readAsset = (filename: string) => {
        const fromHere = path.join(here, filename);
        if (existsSync(fromHere)) return readFileSync(fromHere, "utf8");
        const fromSrc = path.join(process.cwd(), "src", "routes", "api", filename);
        return readFileSync(fromSrc, "utf8");
    };

    const HTML = readAsset("kanban.js");
    const CSS = readAsset("kanban.css");
    const AV_HTML = readAsset("kanban_av.js");
    const AV_CSS = readAsset("kanban_av.css");

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

    server.registerResource(
        "kanban-av-widget",
        "ui://widget/kanban-av.html",
        {},
        async () => ({
            contents: [
                {
                    uri: "ui://widget/kanban-av.html",
                    mimeType: "text/html+skybridge",
                    text: `<div id="kanban-root"></div>
                           <style>${AV_CSS}</style>
                           <script type="module">${AV_HTML}</script>`.trim(),
                    _meta: {
                        "openai/widgetPrefersBorder": true,
                        "openai/widgetDomain": "https://mcp.krdp.ddns.net",
                        "openai/widgetDescription": "Shows an interactive A/V avatar widget",
                        "openai/widgetCSP": {
                            connect_domains: ["https://mcp.krdp.ddns.net","wss://mcp.krdp.ddns.net"],
                            resource_domains: ["https://mcp.krdp.ddns.net","wss://mcp.krdp.ddns.net"],
                        },
                    },
                },
            ],
        })
    );

    server.registerTool(
        'open-av-widget',
        {
            title: 'Open AV Widget',
            description: 'Open the A/V avatar widget (video overlay).',
            inputSchema: {},
            outputSchema: FIX_outputArgs,
            _meta: {
                "openai/outputTemplate": "ui://widget/kanban-av.html",
                "openai/widgetAccessible": true,
                "openai/toolInvocation/invoking": "Opening A/V widget…",
                "openai/toolInvocation/invoked": "A/V widget ready.",
            },
            annotations: {
                title: 'Open AV Widget',
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true
            }
        },
        async () => {
            const output = {
                clientId: 'RelaySelf(No clientID)',
                requestId: 'RelaySelf(No RequestID)',
                data: JSON.stringify({ ok: true })
            };

            return {
                content: [{ type: 'text', text: 'Success' }],
                structuredContent: output
            };
        },
    );

    server.registerTool(
        'set-av-state',
        {
            title: 'Set AV State',
            description: 'Push a state change to all connected A/V widgets over WebSocket.',
            inputSchema: {
                state: z.string(),
                src: z.string().optional()
            },
            outputSchema: FIX_outputArgs,
            annotations: {
                title: 'Set AV State',
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: false
            }
        },
        async (args) => {
            const { state, src } = args;
            widgetAvHub.broadcast({ state, src });

            const output = {
                clientId: 'RelaySelf(No clientID)',
                requestId: 'RelaySelf(No RequestID)',
                data: JSON.stringify({ ok: true, state, src: src ?? null })
            };

            return {
                content: [{ type: 'text', text: 'Success' }],
                structuredContent: output
            };
        },
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
            const { imageprompt, aspectRatio } = args;
            const payload: Record<string, any> = {};
            let imageUrl: string = '';

            try {
                if (imageprompt) {
                    imageUrl = await createImageGen(imageprompt, 1, true, aspectRatio);
                }
                if (!imageUrl) {
                    throw new Error('Generate Image Fail');
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
