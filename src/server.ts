import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { cfg } from './config.js';
import { wsRoutes } from "./routes/websocket.js";
import { apiRoutes } from "./routes/api.js";
import { log } from "./utils/logger.js";
import { z } from 'zod';
import path from "path";

// Create an MCP server
const server = new McpServer({
    name: 'fvtt-mcp-server',
    version: '1.0.0'
});

// Set up Express and HTTP transport
const app = express();
app.use(express.json());

app.post('/sse', async (req, res) => {
    // Create a new transport for each request to prevent request ID collisions
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

/**
 * HTTP server instance that wraps the Express app
 * @public
 */
const httpServer = createServer(app);
// Disable timeouts to keep WebSocket connections open may want to sent a long timeout in the future instead
httpServer.setTimeout(0);
httpServer.keepAliveTimeout = 0;
httpServer.headersTimeout = 0;

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer, path: cfg.WS_PATH });
wsRoutes(wss);
apiRoutes(app, server);

// 1) 오디오 파일 저장 폴더 경로
const audioDir = path.join(process.cwd(), "tts_output");

// 2) /tts 경로를 오디오 파일 공개 경로로 지정 (CORS 허용)
app.use(
    "/tts",
    (req, res, next) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type");
        next();
    },
    express.static(audioDir)
);

/**
 * Initializes all server services in the correct order.
 * 
 * This function performs the following initialization steps:
 * 1. Starts the HTTP and WebSocket servers first
 * 
 * @throws {Error} Exits the process if server startup fails
 * @returns {Promise<void>} Resolves when server is started
 */
async function initializeServices() {
    try {
        httpServer.listen(cfg.PORT, () => {
            log.info(`Server running at http://localhost:${cfg.PORT}`);
            log.info(`MCP server ready at http://localhost:${cfg.PORT}${cfg.MCP_PATH}`);
            log.info(`WebSocket server ready at ws://localhost:${cfg.PORT}${cfg.WS_PATH}`);
        });

        // Do heavy initialization in background after server is running
        setImmediate(async () => {
            try {
                log.info('Starting background initialization...');
                //To-do Backgound services
                log.info('All background services initialized successfully');
            } catch (error) {
                log.error(`Error during background initialization: ${error}`);
                // Don't exit in production - let the server continue running
                if (process.env.NODE_ENV !== 'production') {
                    process.exit(1);
                }
            }
        });

    } catch (error) {
        log.error(`Error starting server: ${error}`);
        process.exit(1);
    }
}

// Handle graceful shutdown
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

// Initialize services and start server
initializeServices().catch(err => {
    log.error(`Failed to initialize services: ${err}`);
    process.exit(1);
});
