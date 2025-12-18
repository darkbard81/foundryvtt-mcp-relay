import { WebSocket } from "ws";

export type WidgetAvPayload = {
  state?: string;
  src?: string;
};

class WidgetAvHub {
  private sockets = new Set<WebSocket>();

  addSocket(ws: WebSocket) {
    this.sockets.add(ws);
  }

  removeSocket(ws: WebSocket) {
    this.sockets.delete(ws);
  }

  broadcast(payload: WidgetAvPayload) {
    const message = JSON.stringify(payload);
    for (const ws of this.sockets) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.send(message);
    }
  }

  get size() {
    return this.sockets.size;
  }
}

export const widgetAvHub = new WidgetAvHub();
