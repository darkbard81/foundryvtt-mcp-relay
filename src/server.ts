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

app.post(cfg.MCP_PATH, async (req, res) => {
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

// === 정적 파일: TTS 오디오 ===
const audioDir = path.join(process.cwd(), cfg.FOUNDRY_DATA_PATH, cfg.AUDIO_OUTPUT_DIR);

app.use(
    cfg.AUDIO_PATH,
    (req, res, next) => {
        res.header("Access-Control-Allow-Origin", "*");
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
        res.header("Access-Control-Allow-Origin", "*");
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
