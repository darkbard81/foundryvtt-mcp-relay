// Relay self widget (A/V): single <video> source switching (PiP-friendly).
const root = document.getElementById("kanban-root") ?? document.getElementById("root");

if (!root) {
  console.error("[kanban_av] root element not found (#kanban-root or #root).");
} else {
  root.innerHTML = `
    <div id="video-wrap" aria-label="avatar-video">
      <video id="avatar" autoplay muted playsinline preload="auto"></video>
      <button id="pip-btn" type="button">PiP</button>
    </div>
  `.trim();
}

const video = document.getElementById("avatar");
const pipBtn = document.getElementById("pip-btn");

if (!(video instanceof HTMLVideoElement)) {
  console.error("[kanban_av] video element not found (#avatar).");
}

const IDLE_SRC = "https://mcp.krdp.ddns.net/img/Idle.webm";
const stateToActionSrc = {
  hello: "https://mcp.krdp.ddns.net/img/Hello.mp4",
  holyPose: "https://mcp.krdp.ddns.net/img/Pose.mp4",
  Step: "https://mcp.krdp.ddns.net/img/Step.mp4",
};

let state = "idle";
let playSeq = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fadeSwap = async (nextSrc, { loop }) => {
  if (!(video instanceof HTMLVideoElement)) return;
  if (!nextSrc) return;

  playSeq += 1;
  const seq = playSeq;

  video.style.opacity = "0";
  await sleep(120);

  if (seq !== playSeq) return;

  video.onended = null;
  video.loop = Boolean(loop);
  video.src = nextSrc;
  video.currentTime = 0;

  try {
    await video.play();
  } catch (err) {
    console.warn("[kanban_av] video.play() failed (autoplay policy?)", err);
  }

  if (seq === playSeq) video.style.opacity = "1";
};

const playIdle = async () => {
  state = "idle";
  await fadeSwap(IDLE_SRC, { loop: true });
};

const playAction = async (src) => {
  if (!(video instanceof HTMLVideoElement)) return;

  const seq = playSeq + 1;
  await fadeSwap(src, { loop: false });

  if (seq !== playSeq) return;

  video.onended = () => {
    if (seq !== playSeq) return;
    void playIdle();
  };
};

function setState(newState) {
  if (typeof newState !== "string" || !newState) return;
  if (state === newState) return;

  if (newState === "idle") {
    void playIdle();
    return;
  }

  const mappedSrc = stateToActionSrc[newState];
  if (mappedSrc) {
    state = newState;
    void playAction(mappedSrc);
    return;
  }

  console.warn(`[kanban_av] unknown state: ${newState}`);
}

const applyPayload = (payload) => {
  if (!payload || typeof payload !== "object") return;

  // supported payload examples:
  // { "state": "hello" }
  // { "state": "idle" }
  // { "state": "action", "src": "https://.../custom.mp4" }
  if (payload.state === "action" && typeof payload.src === "string" && payload.src) {
    state = "action";
    void playAction(payload.src);
    return;
  }

  if (typeof payload.state === "string") setState(payload.state);
};

const extractPayload = () => {
  const toolOutput = window?.openai?.toolOutput;
  const rawData = toolOutput?.data ?? toolOutput?.structuredContent?.data;
  if (typeof rawData !== "string") return null;

  try {
    const parsed = JSON.parse(rawData);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (err) {
    console.error("[kanban_av] Failed to parse tool output data", err);
    return null;
  }
};

const tick = () => {
  const payload = extractPayload();
  if (payload) applyPayload(payload);
};

// Initial state
void playIdle();

// Fallback polling for tool-output widgets.
setInterval(tick, 10000);

const wsConnect = () => {
  try {
    const ws = new WebSocket("wss://mcp.krdp.ddns.net/widget-av");

    ws.onopen = () => {
      ws.send("ping");
    };

    ws.onmessage = (evt) => {
      const text = typeof evt.data === "string" ? evt.data : "";
      if (!text || text === "pong") return;
      try {
        applyPayload(JSON.parse(text));
      } catch (err) {
        console.warn("[kanban_av] invalid WS payload", err);
      }
    };

    ws.onclose = () => {
      setTimeout(wsConnect, 1500);
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };
  } catch (err) {
    console.warn("[kanban_av] WS connect failed", err);
  }
};

wsConnect();

async function togglePiP() {
  if (!(video instanceof HTMLVideoElement)) return;

  if (!document.pictureInPictureEnabled) {
    console.warn("[kanban_av] PiP not supported in this environment.");
    return;
  }

  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture().catch(() => {});
    return;
  }

  try {
    await video.play();
  } catch {}

  await video.requestPictureInPicture().catch((err) => {
    console.warn("[kanban_av] requestPictureInPicture failed", err);
  });
}

if (pipBtn instanceof HTMLButtonElement) {
  pipBtn.addEventListener("click", () => void togglePiP());
}
