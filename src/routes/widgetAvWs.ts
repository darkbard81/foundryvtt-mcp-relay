import { WebSocketServer } from "ws";
import { log } from "../utils/logger.js";
import { widgetAvHub } from "../core/WidgetAvHub.js";

export const widgetAvWsRoutes = (wss: WebSocketServer): void => {
  wss.on("connection", (ws, req) => {
    widgetAvHub.addSocket(ws);
    log.info(`[WidgetAV] connected (clients=${widgetAvHub.size}) url=${req.url ?? ""}`);

    ws.on("close", () => {
      widgetAvHub.removeSocket(ws);
      log.info(`[WidgetAV] disconnected (clients=${widgetAvHub.size})`);
    });

    ws.on("error", (err) => {
      widgetAvHub.removeSocket(ws);
      log.warn(`[WidgetAV] socket error: ${String(err)}`);
    });

    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      if (text === "ping") ws.send("pong");
    });
  });
};

