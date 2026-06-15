# 프론트엔드 설계 스펙 — 유튜브 영상 자동제작 하네스

날짜: 2026-06-15

---

## 개요

현재 CLI 전용(readline)인 파이프라인을 로컬 웹앱으로 전환한다.  
사용자는 브라우저에서 주제를 입력하고, 각 단계 진행을 실시간으로 보며, 필요한 승인만 클릭으로 처리한다.  
코드 변경 최소화 원칙: conductor.js 로직은 건드리지 않고, human-gate.js만 WebSocket 버전으로 교체한다.

---

## 아키텍처

```
브라우저 (public/)
    ↕ WebSocket
server.js  ─── conductor.js (child_process.fork)
                    ↕ IPC (process.send / process.on('message'))
               lib/ws-gate.js  ←── human-gate.js 대체
```

- **server.js**: Express 정적 서빙 + WebSocket 서버. conductor를 `child_process.fork`로 실행하고 IPC로 메시지를 중계한다.
- **public/**: 빌드 없는 순수 HTML/CSS/JS. 단일 페이지, 9개 화면을 JS로 전환.
- **lib/ws-gate.js**: `humanApprove()` 인터페이스 유지, 내부 구현만 WebSocket IPC로 교체.

---

## 파일 구조

```
server.js                  # Express + ws 서버 (신규)
public/
  index.html               # 단일 페이지 앱 진입점 (신규)
  app.js                   # 화면 전환 + WebSocket 클라이언트 (신규)
  style.css                # 전체 스타일 (신규)
lib/
  ws-gate.js               # WebSocket 기반 human gate (신규, human-gate.js 대체)
conductor.js               # --ws 플래그 추가만 (최소 수정)
```

---

## WebSocket 메시지 프로토콜

### Server → Client

| type | 설명 | 주요 필드 |
|---|---|---|
| `log` | 실시간 로그 한 줄 | `level: 'ok'\|'info'\|'warn'\|'error'`, `message` |
| `stage_start` | 스테이지 시작 | `stage: string` |
| `stage_done` | 스테이지 완료 | `stage`, `attempts` |
| `gate` | 사람 승인 요청 | `stage`, `payload` (스테이지별 데이터) |
| `escalation` | 3회 실패 에스컬레이션 | `stage`, `reasons: string[]` |
| `complete` | 전체 파이프라인 완료 | `episodeId`, `videoPath`, `totalSeconds` |

### Client → Server

| type | 설명 | 주요 필드 |
|---|---|---|
| `start` | 파이프라인 시작 | `topic`, `intent`, `fresh?: boolean` |
| `approve` | 게이트 승인 | `stage` |
| `reject` | 게이트 거부 | `stage`, `feedback: string` |

---

## 화면 구성 (9개)

각 화면은 viewport 전체를 채운다. 공통 요소: 상단 토픽바 + 6단계 스텝바.

| # | 화면 | 트리거 | 사용자 액션 |
|---|---|---|---|
| 1 | **시작** | 앱 로드 | 주제·의도 입력 → 시작 버튼 |
| 2 | **실행 중** | `start` 전송 후 | 없음 (로그만 흐름) |
| 3 | **리서치 확인** | `gate: research` | 확인 완료 / 재수집 |
| 4 | **구성 승인 ★** | `gate: structure` | 승인 / 수정 요청 (피드백 입력) |
| 5 | **대본 확인** | `gate: script` | 확인 완료 / 수정 요청 |
| 6 | **음성 확인** | `gate: voice` | 오디오 재생 후 승인 / 재녹음 |
| 7 | **자동 진행 중** | 음성 승인 후 | 없음 |
| 8 | **최종 승인** | `gate: final` | 최종 승인 / 수정 요청 |
| 9 | **완료** | `complete` 수신 | 파일 열기 / 새 영상 |

에스컬레이션 화면은 오버레이로 처리 (별도 페이지 불필요).

---

## 주요 설계 결정

| 결정 | 이유 |
|---|---|
| child_process.fork (IPC) | conductor.js를 수정 없이 별도 프로세스로 실행. IPC로 gate 이벤트만 중계. |
| --ws 플래그 | 플래그 있을 때만 ws-gate 사용. CLI 모드 그대로 유지. |
| 빌드 없는 바닐라 JS | Windows 환경, npm run dev 없이 `node server.js` 한 줄로 실행. |
| WebSocket (ws 패키지) | 이미 package.json에 있음. SSE보다 양방향 통신이 gate 구현에 적합. |
| 오디오 스트리밍 | `/audio/:episodeId` REST 엔드포인트로 mp3 서빙. 브라우저 `<audio>` 태그 재생. |

---

## 실행 방법 (구현 후)

```bash
node server.js
# → http://localhost:3000 브라우저에서 접속
```

conductor.js 직접 실행(CLI)은 기존과 동일하게 유지.

---

## 범위 밖 (이번 구현에 포함 안 함)

- 에피소드 히스토리 목록 화면
- YouTube 자동 업로드
- 다중 동시 에피소드
- 인증/로그인
