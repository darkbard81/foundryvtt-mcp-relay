import path from 'path';
import type { Application, RequestHandler } from 'express';
import express from 'express';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { promises as fs } from 'fs';
import { log } from './utils/logger.js';
import { cfg } from './config.js';
import crypto from 'crypto';

const sessions = new Map<string, { timestamp: number; scope?: string }>();
const tokenStorePath = path.join(process.cwd(), 'token-store.json');
const tokenCache = new Map<string, any>();
const authorizationCodes = new Map<string, { client_id?: string; scope?: string }>();

const sanitize = (value: string | undefined) =>
    (value ?? '').replace(/[';]/g, '').trim();

async function saveTokenFile(data: Record<string, unknown>) {
    try {
        const key = typeof (data as any)?.user?.login === 'string'
            ? (data as any).user.login as string
            : 'default';
        tokenCache.set(key, data);
        const serialized = Object.fromEntries(tokenCache);
        await fs.writeFile(tokenStorePath, JSON.stringify(serialized, null, 2), 'utf8');
        log.info(`[OAuth] Access token saved to ${tokenStorePath} (key=${key})`);
    } catch (err) {
        log.error(`[OAuth] Failed to persist token: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export async function loadOAuthTokens(): Promise<void> {
    try {
        const raw = await fs.readFile(tokenStorePath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, any>;
        if (parsed && typeof parsed === 'object') {
            for (const [key, value] of Object.entries(parsed)) {
                tokenCache.set(key, value);
            }
            log.info(`[OAuth] Loaded ${tokenCache.size} token entries from ${tokenStorePath}`);
        }
    } catch (err: any) {
        if (err?.code === 'ENOENT') {
            log.info(`[OAuth] No existing token store at ${tokenStorePath}, starting fresh`);
        } else {
            log.error(`[OAuth] Failed to load token store: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

export const authenticateMCP: RequestHandler = (req, res, next) => {
    if (!cfg.GITHUB_CLIENT_ID) {
        return next();
    }
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    log.debug(`Middleware Receive Token Header: ${token}`);
    if (!token) {
        log.error(`[OAuth] Middleware: Access token required`);
        return res.status(401).json({ error: 'Access token required' });
    }

    const match = Array.from(tokenCache.values()).find(
        (entry: any) => typeof entry?.access_token === 'string' && entry.access_token === token
    );

    if (!match) {
        log.error(`[OAuth] Middleware: Invalid access token`);
        return res.status(401).json({ error: 'Invalid access token' });
    }

    (req as any).token = token;
    (req as any).user = match.user;
    return next();
};

type DedupeCachedResponse = {
    status: number;
    body: unknown;
    isJson: boolean;
};

type DedupeCacheEntry = {
    expiresAt: number;
    timeout: NodeJS.Timeout;
    response?: DedupeCachedResponse;
    inFlight?: Promise<void>;
};

// 직렬화된 요청 해시를 짧은 TTL 동안 기억해, 동일 요청에는 이전 응답을 반환하는 미들웨어
const dedupeCache = new Map<string, DedupeCacheEntry>();
export function createPayloadDedupeMiddleware(ttlMs = 20000, waitInFlightMs = 30000): RequestHandler {
    return async (req, res, next) => {
        // 1) 중복 처리 대상이 아닌 요청은 빠르게 통과
        // GET/HEAD는 멱등성으로 취급해 패스
        if (req.method === 'GET' || req.method === 'HEAD') {
            return next();
        }

        if (req.body?.method !== "tools/call") {
            return next();
        }

        // 2) 요청 특성으로 해시 키 생성 (본문/쿼리/인증 포함)
        // 요청 전체를 직렬화해 해시 키 생성
        const payload = {
            method: req.method,
            url: req.originalUrl,
            body: req.body ?? null,
            query: req.query ?? null,
            authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
        };
        const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

        // 3) 캐시된 응답이 있으면 즉시 반환, 없으면 in-flight 종료를 대기
        const existing = dedupeCache.get(hash);
        if (existing && existing.expiresAt > Date.now()) {
            if (existing.response) {
                log.warn(`[Middleware] Duplicate payload detected within ${ttlMs}ms window (return cached response)`);
                if (existing.response.isJson) {
                    return res.status(existing.response.status).json(existing.response.body);
                }
                return res.status(existing.response.status).send(existing.response.body as any);
            }

            if (existing.inFlight) {
                try {
                    await Promise.race([
                        existing.inFlight,
                        new Promise<void>((_, reject) =>
                            setTimeout(() => reject(new Error('dedupe_inflight_timeout')), waitInFlightMs)
                        )
                    ]);
                } catch (err) {
                    log.warn(`[Middleware] Duplicate payload detected but in-flight wait failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            const refreshed = dedupeCache.get(hash);
            if (refreshed && refreshed.expiresAt > Date.now() && refreshed.response) {
                log.warn(`[Middleware] Duplicate payload detected after wait (return cached response)`);
                if (refreshed.response.isJson) {
                    return res.status(refreshed.response.status).json(refreshed.response.body);
                }
                return res.status(refreshed.response.status).send(refreshed.response.body as any);
            }
        }

        // 4) 최초 요청: 응답을 임시 캡처해 finish 이후에 저장
        // 최초 요청: 응답을 임시 캡처해 finish 이후에 저장
        let capturedStatus = 200;
        const originalStatus = res.status.bind(res);
        res.status = (code: number) => {
            capturedStatus = code;
            return originalStatus(code);
        };

        const entry: DedupeCacheEntry = {
            expiresAt: Date.now() + ttlMs,
            timeout: setTimeout(() => dedupeCache.delete(hash), ttlMs),
        };

        const inFlight = new Promise<void>((resolve) => {
            res.once('finish', () => resolve());
            res.once('close', () => resolve());
        });
        entry.inFlight = inFlight;

        let pendingBody: unknown = undefined;
        let pendingIsJson = true;
        const streamChunks: Buffer[] = [];

        // 5) JSON/일반 응답 캡처
        const originalJson = res.json.bind(res);
        res.json = (body: any) => {
            pendingBody = body;
            pendingIsJson = true;
            return originalJson(body);
        };

        const originalSend = res.send.bind(res);
        res.send = (body: any) => {
            const isJson = typeof body === 'object' && body !== null && !Buffer.isBuffer(body);
            pendingBody = body;
            pendingIsJson = isJson;
            return originalSend(body);
        };

        // 6) 스트리밍 응답 캡처 (write/end)
        const originalWrite = res.write.bind(res);
        res.write = ((chunk: any, encoding?: any, cb?: any) => {
            if (chunk !== undefined) {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
                streamChunks.push(buf);
            }
            return originalWrite(chunk, encoding, cb);
        }) as typeof res.write;

        const originalEnd = res.end.bind(res);
        res.end = ((chunk?: any, encoding?: any, cb?: any) => {
            if (chunk !== undefined) {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
                streamChunks.push(buf);
            }
            return originalEnd(chunk, encoding, cb);
        }) as typeof res.end;

        dedupeCache.set(hash, entry);

        // 7) 연결 종료/완료 시 캐시 저장 또는 정리
        res.once('close', () => {
            if (!entry.response) {
                clearTimeout(entry.timeout);
                dedupeCache.delete(hash);
            }
        });

        res.once('finish', () => {
            if (pendingBody === undefined && streamChunks.length > 0) {
                const buffer = Buffer.concat(streamChunks);
                const contentType = res.getHeader('content-type');
                const contentTypeValue = typeof contentType === 'string' ? contentType : Array.isArray(contentType) ? contentType.join(';') : '';
                if (contentTypeValue.includes('application/json')) {
                    try {
                        pendingBody = JSON.parse(buffer.toString('utf8'));
                        pendingIsJson = true;
                    } catch {
                        pendingBody = buffer.toString('utf8');
                        pendingIsJson = false;
                    }
                } else {
                    pendingBody = buffer;
                    pendingIsJson = false;
                }
            }

            if (pendingBody === undefined) return;
            entry.response = { status: capturedStatus, body: pendingBody, isJson: pendingIsJson };
            entry.expiresAt = Date.now() + ttlMs;
        });

        return next();
    };
}

export function registerOAuthRoutes(app: Application): void {
    if (!cfg.GITHUB_CLIENT_ID) {
        return;
    }

    loadOAuthTokens();

    app.get('/.well-known/oauth-protected-resource', (req, res) => {
        res.json({
            resource: 'https://mcp.krdp.ddns.net',
            authorization_servers: ['https://github.com/login/oauth'],
            scopes_supported: ['read:user', 'repo'],
            bearer_methods_supported: ['header'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
            token_endpoint_auth_signing_alg_values_supported: ['RS256'],
        });
    });

    app.get('/authorize', (req, res) => {
        const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        log.info(`[OAuth] authorize called from ${fullUrl}`);

        const state = typeof req.query.state === 'string'
            ? req.query.state
            : Array.isArray(req.query.state)
                ? (req.query.state[0] as string)
                : randomUUID();
        log.info(state);
        const scope = encodeURIComponent('read:user repo');
        const redirectUri = encodeURIComponent(sanitize(cfg.GITHUB_REDIRECT_URI));
        const clientId = sanitize(cfg.GITHUB_CLIENT_ID);
        const url =
            `https://github.com/login/oauth/authorize?` +
            `client_id=${clientId}&` +
            `redirect_uri=${redirectUri}&` +
            `scope=${scope}&` +
            `state=${state}`;

        log.info(url);
        sessions.set(state, { timestamp: Date.now(), scope });

        res.redirect(url);
    });

    app.get('/auth/callback', async (req, res) => {
        const { code, state, error } = req.query;
        const codeStr = typeof code === 'string' ? code : Array.isArray(code) ? code[0] as string : undefined;
        const stateStr = typeof state === 'string' ? state : Array.isArray(state) ? state[0] as string : undefined;
        const errorStr = typeof error === 'string' ? error : Array.isArray(error) ? error[0] as string : undefined;

        if (errorStr) {
            log.error(`[OAuth] /auth/callback: ${errorStr}`);
            return res.redirect(`/?error=${encodeURIComponent(errorStr)}`);
        }

        if (!codeStr || !stateStr) {
            log.error('[OAuth] /auth/callback: missing_code_or_state');
            return res.redirect('/?error=missing_code_or_state');
        }

        const sessionData = sessions.get(stateStr);
        if (!sessionData) {
            log.error('[OAuth] /auth/callback: invalid_state');
            return res.redirect('/?error=invalid_state');
        }

        sessions.delete(stateStr);

        const redirectURL = sanitize(cfg.CHATGPT_REDIRECT_URI);
        try {
            const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
                client_id: sanitize(cfg.GITHUB_CLIENT_ID),
                client_secret: sanitize(cfg.GITHUB_CLIENT_SECRET),
                code: codeStr,
                state: stateStr,
            }, {
                headers: {
                    'Accept': 'application/json',
                }
            });

            const { access_token, token_type, scope } = tokenResponse.data;

            if (!access_token) {
                throw new Error('No access token received');
            }

            const userResponse = await axios.get('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Accept': 'application/vnd.github+json',
                }
            });

            const user = userResponse.data;
            await saveTokenFile({
                access_token,
                token_type,
                scope: scope || sessionData.scope,
                user
            });

            const params = new URLSearchParams({
                success: 'true',
                code: codeStr,
                state: stateStr,
                scope: scope || sessionData.scope,
            });

            log.info(`${redirectURL}?${params.toString()}`);
            res.status(200).redirect(`${redirectURL}?${params.toString()}`);

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            log.error(`[OAuth] /auth/callback: ${message}`);
            res.redirect(`${redirectURL}?error=${encodeURIComponent('oauth_exchange_failed')}`);
        }
    });

    app.all('/token', express.urlencoded({ extended: true }), (req, res) => {
        log.debug(`[OAuth] /token hit with body=${JSON.stringify(req.body)}`);

        const { grant_type, code, client_id, client_secret } = req.body as Record<string, string | undefined>;

        if (grant_type !== 'authorization_code' || !code) {
            log.error(`[OAuth] /token unsupported_grant_type = ${grant_type}`);
            return res.status(400).json({ error: 'unsupported_grant_type' });
        }

        const expectedClientId = sanitize(cfg.GITHUB_CLIENT_ID);
        const expectedSecret = sanitize(cfg.GITHUB_CLIENT_SECRET);
        if (expectedClientId && client_id && client_id !== expectedClientId) {
            return res.status(400).json({ error: 'invalid_client' });
        }
        if (expectedSecret && client_secret && client_secret !== expectedSecret) {
            return res.status(400).json({ error: 'invalid_client_secret' });
        }

        const codeEntry = authorizationCodes.get(code) ?? { client_id, scope: 'read:user repo' };
        if (!authorizationCodes.has(code)) {
            log.warn(`[OAuth] /token code ${code} not previously issued; accepting for debug`);
        }

        const existingToken = Array.from(tokenCache.values()).find(
            (entry: any) => typeof entry?.access_token === 'string'
        ) as any | undefined;

        const access_token = existingToken?.access_token;

        if (!access_token) {
            log.error(`[OAuth] /token Token dose not exsist`);
            return res.status(400).json({ error: 'Token dose not exsist' });
        }
        const tokenPayload = {
            access_token,
            token_type: 'Bearer',
            scope: codeEntry.scope,
        };

        return res.status(200).json(tokenPayload);
    });

    app.all('/register', express.urlencoded({ extended: true }), (req, res) => {
        log.debug(`[OAuth] /register hit with body=${JSON.stringify(req.body)}`);
        return res.status(400).json({ error: 'not_implemented', received: req.body });
    });
}
