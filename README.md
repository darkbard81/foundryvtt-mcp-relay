# Foundry MCP Relay
LLM ↔ MCP 서버(본 프로젝트) ↔ Foundry VTT 사이에서 이벤트와 메시지를 중계하는 Node.js/TypeScript 애플리케이션입니다.

## 빠른 시작
```bash
npm install          # 의존성 설치
cp .env.example .env # 환경 변수 템플릿 복사
npm run dev          # 개발 모드 실행
```

## 요구 사항
- Node.js 20+
- npm 10+

## 환경 변수
`.env.example`을 복사해 `.env`를 만들고 값을 채웁니다.
```txt
PORT=3000                    # 서버 바인드 포트
FOUNDRY_URL=http://localhost:30000
MCP_SERVER_URL=http://localhost:4000
```
추가 항목이 필요하면 `.env.example`과 이 섹션을 함께 업데이트해 주세요.

## 스크립트
| 명령 | 설명 |
| --- | --- |
| `npm run dev` | MCP 로더 등록 후 개발 모드 실행 (`loader-register.mjs` 사용). |
| `npm run build` | TypeScript를 `dist/`로 트랜스파일. |
| `npm start` | 빌드 산출물 `dist/server.js` 실행(프로덕션). |

## 배포 (컨테이너)
이미지 풀 및 실행 예시:
```bash
podman pull ghcr.io/darkbard81/fvtt-mcp:latest
podman run -d --name fvtt-mcp \
  --env-file .env \
  -p 3000:3000 \
  ghcr.io/darkbard81/fvtt-mcp:latest
```
`podman-compose`를 쓰면 `env_file: [.env]`로 동일하게 주입할 수 있습니다.

## 개발 흐름
1. `.env` 준비 → `npm run dev`로 연동 확인.
2. 변경 후 `npm run build`로 타입/빌드 확인.
3. 태그 푸시로 GitHub Actions가 릴리스/컨테이너 이미지를 생성합니다.

## 구조
```txt
├── src/               # TypeScript 소스
├── dist/              # 빌드 산출물
├── loader-register.mjs
└── AGENTS.md          # 에이전트 설정 문서
```

## 참고: 인증 옵션
- Keycloak: 기능 풍부, 다소 무거움(Java)
- Ory Hydra: 표준 준수, 비교적 경량
- Authelia: 셋업 간단
- OAuth2 Proxy: 기존 앱 앞단에 인증 레이어 추가
