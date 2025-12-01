import 'dotenv/config';
import { LogLevel } from './types/types.js';

const toInt = (v: string | undefined, d: number) =>
  v ? Number.parseInt(v, 10) : d;

export const cfg = {
  /** API KEY Obligatory for FoundryVTT Module link */
  API_KEY: process.env.MCP_SERVER_API_KEY,
  AUDIO_MODEL: process.env.AUDIO_MODEL ?? 'gemini-2.5-flash-preview-tts',
  AUDIO_OUTPUT_DIR: process.env.AUDIO_OUTPUT_DIR ?? 'tts_output',
  AUDIO_PATH: process.env.AUDIO_PATH ?? '/tts',
  BASE_URL: process.env.BASE_URL ?? 'http://localshost:3010',
  CLIENT_CLEANUP_INTERVAL_MS: toInt(process.env.CLIENT_CLEANUP_INTERVAL_MS, 15_000),
  DB_TYPE: process.env.DB_TYPE ?? 'memory',
  FOUNDRY_DATA_PATH: process.env.FOUNDRY_DATA_PATH ?? '',
  GH_PROJECT: process.env.GH_PROJECT,
  GH_TAG: process.env.GH_TAG,
  /** Google Optional - limited function */
  GOOGLE_GENAI_API_KEY: process.env.GOOGLE_GENAI_API_KEY,
  GOOGLE_GENAI_PROJECT_ID: process.env.GOOGLE_GENAI_PROJECT_ID ?? 'none',
  GOOGLE_GENAI_PROJECT_LOCATION: process.env.GOOGLE_GENAI_PROJECT_LOCATION ?? 'global',
  HOST: process.env.WS_HOST ?? '0.0.0.0',
  IMAGE_MODEL: process.env.IMAGE_MODEL ?? 'gemini-2.5-flash-image',
  IMAGE_OUTPUT_DIR: process.env.IMAGE_OUTPUT_DIR ?? 'img_output',
  IMAGE_PATH: process.env.IMAGE_PATH ?? '/img', 
  INSTANCE_ID: process.env.FLY_ALLOC_ID ?? 'local',
  LOG_LEVEL: (process.env.LOG_LEVEL as LogLevel | undefined) ?? LogLevel.INFO,
  MCP_PATH: process.env.MCP_PATH ?? '/sse',
  MODULE_VERSION: process.env.MODULE_VERSION ?? '1.0.0',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PING_INTERVAL_MS: toInt(process.env.PING_INTERVAL_MS, 20_000),
  PORT: toInt(process.env.WS_PORT, 3010),
  WEBSOCKET_PING_INTERVAL_MS: toInt(process.env.WEBSOCKET_PING_INTERVAL_MS, 20_000),
  WS_PATH: process.env.WS_PATH ?? '/relay',
} as const;
