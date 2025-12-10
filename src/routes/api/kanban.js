// Relay self widget: show generated image if present
const root = document.getElementById("kanban-root") ?? document.getElementById("root");

const render = (url) => {
  if (url) {
    root.innerHTML = `<label text="${url}"><img src="${url}" alt="Generated image" style="max-width: 100%; height: auto;" />`;
  } else {
    root.textContent = "이미지를 기다리는 중...";
  }
};

const extractUrl = () => {
  const toolOutput = window?.openai?.toolOutput;
  const rawData = toolOutput?.data ?? toolOutput?.structuredContent?.data;
  if (typeof rawData !== "string") return "";
  try {
    const parsed = JSON.parse(rawData);
    return parsed?.url ?? "";
  } catch (err) {
    console.error("Failed to parse tool output data", err);
    return "";
  }
};

let attempts = 0;
const maxAttempts = 12; // 12 * 5s = 60s
const intervalMs = 5000;

const tick = () => {
  const url = extractUrl();
  if (url) {
    render(url);
    clearInterval(timer);
  } else if (attempts >= maxAttempts) {
    root.textContent = "생성된 이미지가 없습니다.";
    clearInterval(timer);
  }
  attempts += 1;
};

render(extractUrl());
const timer = setInterval(tick, intervalMs);
