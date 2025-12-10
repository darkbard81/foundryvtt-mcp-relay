import path from "path";
import express from 'express';
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { apiRoutes } from "./routes/api.js";
import { cfg } from './config.js';
import { wsRoutes } from "./routes/websocket.js";
import { log } from "./utils/logger.js";
import { authenticateMCP, createPayloadDedupeMiddleware, registerOAuthRoutes } from "./oAuth.js";

// === 인스턴스 준비: MCP + 환경 필수값 확인 ===
const server = new McpServer({
    name: 'fvtt-mcp-server',
    version: cfg.MODULE_VERSION,
});

if (!cfg.API_KEY) {
    log.error('MCP_SERVER_API_KEY가 설정되지 않았습니다. .env를 확인하고 다시 실행하세요.');
    process.exit(1);
}

if (!cfg.GOOGLE_GENAI_API_KEY) {
    log.warn('GOOGLE_GENAI_API_KEY가 설정되지 않았습니다. TTS 기능이 제한될 수 있습니다.');
}

// === Express 앱 및 MCP 엔드포인트 ===
const app = express();
app.use(express.json());

registerOAuthRoutes(app);

// 중복 payload 재실행 방지용 간단 멱등 미들웨어 (짧은 TTL)
const dedupeMiddleware = createPayloadDedupeMiddleware(10000);

app.post(cfg.MCP_PATH, dedupeMiddleware, authenticateMCP, async (req, res) => {
    log.debug(`[MCP] Incoming POST ${req.originalUrl} body=${JSON.stringify(req.body ?? {})}`);
    // 요청별 새로운 Transport로 request ID 충돌 방지
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
    });

    res.on('close', () => {
        transport.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});

// GET 핸드셰이크(SSE)도 동일하게 처리
app.get(cfg.MCP_PATH, authenticateMCP, async (req, res) => {
    log.debug(`[MCP] Incoming GET ${req.originalUrl} query=${JSON.stringify(req.query ?? {})}`);
    return res.status(200);
});

// === HTTP 서버 인스턴스 ===
const httpServer = createServer(app);
// WebSocket 유지를 위해 타임아웃 비활성화
httpServer.setTimeout(0);
httpServer.keepAliveTimeout = 0;
httpServer.headersTimeout = 0;

// === WebSocket 서버 ===
const wss = new WebSocketServer({ server: httpServer, path: cfg.WS_PATH });
wsRoutes(wss);
apiRoutes(app, server);

// === CORS Array ===
const allowed = cfg.CORS_URL.split(",").map((v) => v.trim()).filter(Boolean);

// === 정적 파일: TTS 오디오 ===
const audioDir = path.join(process.cwd(), cfg.FOUNDRY_DATA_PATH, cfg.AUDIO_OUTPUT_DIR);

app.use(
    cfg.AUDIO_PATH,
    (req, res, next) => {
        const origin = req.headers.origin;
        if (origin && allowed.includes(origin)) {
            res.header("Access-Control-Allow-Origin", origin);
        }
        res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type");
        next();
    },
    express.static(audioDir)
);

// === 정적 파일: TTS 오디오 ===
const imageDir = path.join(process.cwd(), cfg.FOUNDRY_DATA_PATH, cfg.IMAGE_OUTPUT_DIR);

app.use(
    cfg.IMAGE_PATH,
    (req, res, next) => {
        const origin = req.headers.origin;
        if (origin && allowed.includes(origin)) {
            res.header("Access-Control-Allow-Origin", origin);
        }
        res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type");
        next();
    },
    express.static(imageDir)
);

async function initializeServices() {
    try {
        httpServer.listen(cfg.PORT, () => {
            log.info(`Server running at http://localhost:${cfg.PORT}`);
            log.info(`MCP server ready at http://localhost:${cfg.PORT}${cfg.MCP_PATH}`);
            log.info(`WebSocket server ready at ws://localhost:${cfg.PORT}${cfg.WS_PATH}`);
        });

        // 서버 기동 후 백그라운드 초기화 작업
        setImmediate(async () => {
            try {
                log.info('Starting background initialization...');
                // To-do: Backgound services
                log.info('All background services initialized successfully');
            } catch (error) {
                log.error(`Error during background initialization: ${error}`);
                if (cfg.NODE_ENV !== 'production') {
                    process.exit(1);
                }
            }
        });

    } catch (error) {
        log.error(`Error starting server: ${error}`);
        process.exit(1);
    }
}

// === Graceful shutdown ===
process.on('SIGTERM', async () => {
    log.info('SIGTERM received, shutting down gracefully');
    httpServer.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    log.info('SIGINT received, shutting down gracefully');
    httpServer.close();
    process.exit(0);
});

// === Bootstrap ===
initializeServices().catch(err => {
    log.error(`Failed to initialize services: ${err}`);
    process.exit(1);
});
