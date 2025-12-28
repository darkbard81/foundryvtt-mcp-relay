import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { baseArgs, FIX_outputArgs, formatToolError } from './common.js';
import { sendClientRequest } from '../route-helpers.js';
import { createImageGen } from '../../utils/assetGenerator.js';
import { z } from 'zod';

// Bridge와 동일한 저널 데이터 형태 정의 (Foundry 의존 없이 직렬화된 데이터 기준)
export type JournalEntrySource = {
    _id: string;
    title: string;
    sort: number;
};

export type JournalEntryPageSource = {
    _id?: string;
    name?: string;
    title?: string | { level?: number; show?: boolean };
    sort?: number;
    sorter?: number;
    type?: string;
    text?: { format?: number; content?: string; markdown?: string };
    system?: Record<string, unknown>;
    flags?: Record<string, unknown>;
    [key: string]: unknown;
};

// createEmbeddedDocuments payload에 바로 넣을 수 있는 최소 필드 예시용 타입
export type JournalEntryPageCreateInput = {
    name?: string;
    sorter?: number;
    text?: { format?: number; markdown?: string };
    title?: { level?: number; show?: boolean } | string;
};

/**
 * @typedef JournalEntryPageImageData
 * @property {string} [caption]           A caption for the image.
 */
export type JournalEntryPageImageData = { caption?: string };
/**
 * @typedef JournalEntryPageTextData
 * @property {string} [content]           The content of the JournalEntryPage in a format appropriate for its type.
 * @property {string} [markdown]          The original markdown source, if applicable.
 * @property {number} format              The format of the page's content, in CONST.JOURNAL_ENTRY_PAGE_FORMATS.
 */
export type JournalEntryPageTextData = { content?: string; markdown?: string; format: number };

/**
 * @typedef JournalEntryPageVideoData
 * @property {boolean} controls         Show player controls for this video?
 * @property {boolean} loop             Automatically loop the video?
 * @property {boolean} autoplay         Should the video play automatically?
 * @property {number}  volume           The volume level of any audio that the video file contains.
 * @property {number}  timestamp        The starting point of the video, in seconds.
 * @property {number}  width            The width of the video, otherwise it will fill the available container width.
 * @property {number}  height           The height of the video, otherwise it will use the aspect ratio of the source
 *                                      video, or 16:9 if that aspect ratio is not available.
 */
export type JournalEntryPageVideoData = {
    controls?: boolean; loop?: boolean; autoplay?: boolean;
    volume?: number; timestamp?: number; width?: number; height?: number;
};
/**
 * @typedef JournalEntryPageTitleData
 * @property {boolean} show               Whether to render the page's title in the overall journal view.
 * @property {number} level               The heading level to render this page's title at in the overall journal view.
 */
export type JournalEntryPageTitleData = { show?: boolean; level?: number };


interface DocumentStats {
    compendiumSource: null | string;
    coreVersion: null | string;
    createdTime: null | number;
    duplicateSource: null | string;
    lastModifiedBy: null | string;
    modifiedTime: null | number;
    systemId: null | string;
    systemVersion: null | string;
}

/**기본 키는 default, 그 외는 userId -> permissionLevel */
export type JournalOwnership = {
    default?: number;
    [userId: string]: number | undefined;
};

/**
 * 직렬화된 JournalEntryPage 데이터 구조 (Foundry 의존 없이 전달 가능한 형태).
 *
 * @property _id        고유 ID (신규 생성 시 생략 가능)
 * @property name       페이지 이름
 * @property type       페이지 타입 (text, image 등)
 * @property title      제목 렌더링 옵션
 * @property image      이미지 타입일 때의 부가 데이터
 * @property text       텍스트 타입일 때의 부가 데이터
 * @property video      비디오 타입일 때의 부가 데이터
 * @property src        외부 미디어 URI
 * @property system     시스템 전용 데이터
 * @property category   선택적 카테고리
 * @property sort       정렬 우선순위
 * @property ownership  userId -> permission level 매핑 (default 포함)
 * @property flags      모듈/시스템 확장을 위한 flags
 * @property _stats     생성·수정 메타데이터
 */
export type JournalEntryPageData = {
    _id?: string | null;
    name: string;
    type: string;
    title: JournalEntryPageTitleData;
    image?: JournalEntryPageImageData;
    text?: JournalEntryPageTextData;
    video?: JournalEntryPageVideoData;
    src?: string;
    system?: Record<string, unknown>;
    category?: string;
    sort: number;
    ownership?: JournalOwnership;
    flags?: Record<string, Record<string, unknown>>;
    _stats?: DocumentStats;
};

export type JournalPageListItem = { id: string; name: string };

export type JournalPageListResult =
    | { success: true; pages: JournalPageListItem[] }
    | { success: false; error: string; pages?: JournalPageListItem[] };

export type JournalPageActionResult =
    | { success: true; page: JournalEntryPageSource | { _id: string; deleted: true } }
    | { success: false; error: string };

export function registerJournalTools(server: McpServer): void {
    const listArgs = {
        ...baseArgs,
    };

    const pageListArgs = {
        ...baseArgs,
        journalId: z.string(),
    };

    const pageDataSchema = z.object({
        name: z.string().describe('PageTitle'),
        type: z.enum(['text', 'image', 'video']).default('text'), // text, image 등
        title: z.object({
            show: z.boolean().default(false),
            level: z.number().default(1),
        }).describe('Option for Title'),
        image: z.object({
            caption: z.string().optional(),
        }).optional().describe('Option for Image'),
        text: z.object({
            content: z.string().optional().describe('HTML'),
            markdown: z.string().optional().describe('Markdown'),
            format: z.number().default(2).describe('1:HTML, 2:Markdown'), // CONST.JOURNAL_ENTRY_PAGE_FORMATS
        }).optional(),
        video: z.object({
            controls: z.boolean().optional().default(true),
            loop: z.boolean().optional().default(false),
            autoplay: z.boolean().optional().default(true),
            volume: z.number().optional().default(0.5),
            timestamp: z.number().optional(),
            width: z.number().optional(),
            height: z.number().optional(),
        }).optional().describe('Option for Video'),
        src: z.string().optional().describe('Image URL'),
        sort: z.number().default(100000).optional(),
    }).passthrough();


    const pageArgs = {
        ...baseArgs,
        action: z.enum(['create', 'update', 'delete', 'read']),
        journalId: z.string(),
        pageId: z.string().optional(),
        pageData: pageDataSchema.optional(),
        imageprompt: z.string().optional()
    };


    server.registerTool(
        'journal-list',
        {
            title: 'Get Journal List',
            description: 'Fetch all journals for a Foundry client',
            inputSchema: listArgs,
            outputSchema: FIX_outputArgs,
            annotations: {
                title: 'Safe journal list',
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async (args) => {
            const { clientId } = args;
            const payload: Record<string, any> = {};

            try {
                const response = await sendClientRequest({
                    type: 'journal-list',
                    clientId,
                    payload,
                });

                const output = {
                    clientId: response.clientId,
                    requestId: response.requestId,
                    data: response.data as JournalEntrySource
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

    server.registerTool(
        'journal-page-list',
        {
            title: 'Get Journal Page List',
            description: 'Fetch pages for a specific journal',
            inputSchema: pageListArgs,
            outputSchema: FIX_outputArgs,
            annotations: {
                title: 'Safe journal page list',
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        async (args) => {
            const { clientId, journalId } = args;
            const payload = { journalId };

            try {
                const response = await sendClientRequest({
                    type: 'journal-page-list',
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

    server.registerTool(
        'journal-page',
        {
            title: 'Journal Page CRUD',
            description: 'Create, update, delete, or read a journal page',
            inputSchema: pageArgs,
            outputSchema: FIX_outputArgs,
            annotations: {
                title: 'Journal page mutation',
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: true
            }
        },
        async (args) => {
            const { clientId, action, journalId, pageId, pageData, imageprompt } = args;
            const payload: Record<string, any> = {
                action,
                journalId,
            };
            if (pageId) payload.pageId = pageId;
            if (pageData) payload.pageData = { ...pageData };
            if (
                action === 'create' &&
                pageData?.type === 'image' &&
                !pageData.src &&
                imageprompt
            ) {
                const src = await createImageGen(imageprompt, 1, false);
                payload.pageData = { ...pageData, src };
            }

            if (
                action === 'create' &&
                pageData?.type === 'text' &&
                imageprompt
            ) {
                const imageUrl = await createImageGen(imageprompt, 1, false);
                const existingMarkdown = pageData.text?.markdown ?? '';
                const imageLine = `![${pageData.name ?? 'image'}](${imageUrl})`;
                payload.pageData = {
                    ...pageData,
                    text: {
                        ...pageData.text,
                        markdown: `${imageLine}\n${existingMarkdown}`
                    }
                };
            }

            try {
                const response = await sendClientRequest({
                    type: 'journal-page',
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
