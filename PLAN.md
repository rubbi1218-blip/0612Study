# 유튜브 영상 자동제작 하네스 — 구현 계획

## Context

CLAUDE.md에 정의된 YouTube 영상 자동 제작 파이프라인을 구현한다. Claude Code(Conductor)가 A1~A6 에이전트를 순서대로 호출하고, V1~V6 검사 에이전트가 각 단계를 검증하며, state.json으로 중간 상태를 관리해 재시작 시 이어서 진행할 수 있게 한다.

**핵심 제약사항:**
- Windows 11, PowerShell 환경
- Python 없음 (Windows Store stub) — 모든 코드 검증은 Node.js로
- Node.js v24.16.0, FFmpeg 8.1.1 설치 확인됨
- Phase 0부터 시작: A1(리서치) + A3(대본) + A4(음성) 사슬만 먼저 구현

---

## 디렉터리 구조

```
E:\클로드프로젝트_0612\
├── CLAUDE.md                        # 이미 존재 — Conductor 지시서
├── CANON.md                         # 채널 정체성·톤 ✅ 완성됨
├── PLAN.md                          # 이 파일
│
├── conductor.js                     # 메인 진입점 — 파이프라인 루너
├── config.js                        # API 키·상수 모음
├── .env                             # API 키 (커밋 금지)
├── package.json
│
├── agents/
│   ├── a1-research.js               # Gemini + Search 그라운딩
│   ├── a3-script.js                 # Claude API (별도 인스턴스)
│   └── a4-voice.js                  # ElevenLabs TTS
│
├── verifiers/
│   ├── v1-research-check.js         # Phase 0: 코드 검사 + 사람 패스스루
│   ├── v3-script-check.js           # Phase 0: 글자수 검사 + 사람 패스스루
│   └── v4-voice-check.js            # Phase 0: 파일 존재·길이 검사 + 사람
│
├── lib/
│   ├── state-manager.js             # state.json 읽기/쓰기/재개 관리
│   ├── canon-loader.js              # CANON.md 읽기 → 에이전트 프롬프트 주입
│   ├── human-gate.js                # CLI 승인 UI (readline)
│   ├── gemini-runner.js             # Gemini API HTTP 클라이언트
│   ├── elevenlabs-runner.js         # ElevenLabs HTTP 클라이언트
│   └── claude-runner.js             # Anthropic SDK 래퍼
│
├── verify-tools/
│   ├── check-audio.js               # FFmpeg 기반 오디오 검증
│   └── check-json.js                # JSON 필드 존재·타입 검사
│
└── output/
    └── {episode-id}/
        ├── state.json               # 에피소드별 상태
        ├── research.json
        ├── script.json
        ├── voice.json
        └── audio.mp3
```

---

## Phase별 구현 계획

---

## Phase 0 — 리서치→대본→음성 사슬
> 목표: `node conductor.js "주제"` 한 줄로 A1→A3→A4가 돌아간다. 검증은 전부 사람.
> 완료 기준: 2주 이상 안정적으로 동작 → Phase 1 진입

---

### Phase 0-A: 프로젝트 뼈대
> 실행 가능한 빈 껍데기 만들기

| 파일 | 할 일 | 상태 |
|------|--------|------|
| `.env` | API 키 4개 입력 | ✅ 완성 |
| `CANON.md` | 채널 정체성 정의 | ✅ 완성 |
| `package.json` | `"type":"module"`, 의존성 선언 (`@anthropic-ai/sdk`, `dotenv`) | ⬜ |
| `.gitignore` | `.env`, `output/`, `node_modules/` 제외 | ⬜ |
| `npm install` | 패키지 설치 | ⬜ |
| `config.js` | API 키·상수 한 곳에 집중 (MAX_RETRIES, 목표 길이, 엔드포인트) | ⬜ |

**완료 체크:** `node -e "import('./config.js').then(m => console.log('OK', m.CONFIG.MAX_RETRIES))"` 출력 확인

---

### Phase 0-B: 상태 관리 시스템
> 파이프라인이 중간에 죽어도 이어서 재개 가능하게

| 파일 | 할 일 | 상태 |
|------|--------|------|
| `lib/state-manager.js` | state.json CRUD, 원자적 쓰기(tmp→rename), 에피소드 ID 생성 | ⬜ |
| `lib/canon-loader.js` | CANON.md 읽어서 문자열 반환 | ⬜ |

**완료 체크:** state-manager 단위 테스트 — init → save → load → isComplete 흐름 확인

---

### Phase 0-C: 사람 승인 UI
> CLI에서 사람이 y/n으로 각 단계를 승인

| 파일 | 할 일 | 상태 |
|------|--------|------|
| `lib/human-gate.js` | readline 기반 CLI 승인 UI (y=승인, n=거부+피드백, q=종료) | ⬜ |

**완료 체크:** `node lib/human-gate.js` 직접 실행 → 프롬프트 표시·입력 수신 확인

---

### Phase 0-D: 코드 검증 도구
> 글자·파일·오디오를 코드로 검사 (LLM 아님)

| 파일 | 할 일 | 상태 |
|------|--------|------|
| `verify-tools/check-json.js` | JSON 객체에서 필수 필드 존재·타입 검사 함수 | ⬜ |
| `verify-tools/check-audio.js` | FFmpeg probe로 오디오 파일 길이·코덱 검사 | ⬜ |

**완료 체크:** `ffprobe -v quiet -print_format json -show_format` 명령어 실행 확인

---

### Phase 0-E: Verifier 스텁 (Phase 0용)
> 코드 최소 검사만 하고 나머지는 사람에게 넘김

| 파일 | 검사 내용 | 상태 |
|------|-----------|------|
| `verifiers/v1-research-check.js` | claims[] 각 항목에 `source_url`, `source_date`, `value` 존재 여부 | ⬜ |
| `verifiers/v3-script-check.js` | 총 글자수 ±10% 범위, 각 줄 60자 이하 | ⬜ |
| `verifiers/v4-voice-check.js` | 아래 3가지 순서대로 실행 | ⬜ |

**V4 세부 검사 순서:**
1. **파일 검사** — `audio.mp3` 존재 + FFmpeg probe로 실제 길이 확인 (추정치 ±20%)
2. **STT 오프셋 측정** — AssemblyAI로 오디오 받아쓰기 → 첫 단어 실제 시작 시간 측정
   ```
   offset = STT 첫 단어 시작(ms) - ElevenLabs 첫 단어 시작(ms)
   → payload에 sync_offset_ms 저장
   ```
3. **오프셋 보정 적용** — `lib/timestamp-processor.js`가 ElevenLabs timestamps 전체에 offset 적용 → 보정된 timestamps를 payload에 저장

**완료 체크:** 더미 데이터로 PASS/FAIL 판정 각각 확인, sync_offset_ms 출력 확인

---

### Phase 0-F: API 클라이언트
> 각 외부 API 연결 (에이전트와 분리해서 테스트 가능하게)

| 파일 | 역할 | 상태 |
|------|------|------|
| `lib/gemini-runner.js` | Gemini 2.5 Pro API + `googleSearch` 그라운딩 호출 | ⬜ |
| `lib/claude-runner.js` | Anthropic SDK (`claude-opus-4-8`) 호출 | ⬜ |
| `lib/elevenlabs-runner.js` | ElevenLabs `/with-timestamps` 엔드포인트 호출 | ⬜ |

**완료 체크:** 각 runner 단독으로 API 핑 테스트 (짧은 입력으로 응답 수신 확인)

---

### Phase 0-G: A1 리서치 에이전트
> Gemini가 주제를 받아 출처 있는 claims 배열을 반환

| 파일 | 할 일 | 상태 |
|------|--------|------|
| `agents/a1-research.js` | Gemini + Search 그라운딩으로 claims[] 생성, feedback 반영 로직 | ⬜ |

**완료 체크:** `node agents/a1-research.js "미국 금리"` → claims JSON 출력, source_url 포함 확인

---

### Phase 0-H: A3 대본 에이전트
> claims를 받아 TTS 호흡 단위 대본 생성

| 파일 | 할 일 | 상태 |
|------|--------|------|
| `agents/a3-script.js` | Claude API로 내레이션 대본 작성, 글자수 코드로 직접 계산 | ⬜ |

**완료 체크:** `node agents/a3-script.js` → lines[] 출력, 글자수·추정 초 확인

---

### Phase 0-I: A4 음성 에이전트 + 타임스탬프 처리
> 대본을 받아 MP3 + 보정된 자막 타임스탬프 생성

| 파일 | 할 일 | 상태 |
|------|--------|------|
| `agents/a4-voice.js` | ElevenLabs `/with-timestamps` → `audio.mp3` 저장 + 단어별 raw timestamps 추출 | ⬜ |
| `lib/timestamp-processor.js` | 아래 3단계 처리 담당 | ⬜ |

**`lib/timestamp-processor.js` 처리 흐름:**

```
[1] 단어 그룹핑
    ElevenLabs 단어별 timestamps
    → 한 줄 최대 20자 기준으로 단어 묶기
    → 자막 줄 배열 생성
    예) [{text:"금리 인하 전망", start_ms:1240, end_ms:2440}, ...]

[2] 오프셋 보정 (V4에서 측정한 sync_offset_ms 주입)
    line.start_ms += sync_offset_ms
    line.end_ms   += sync_offset_ms

[3] SRT 파일 + Remotion용 JSON 동시 출력
    ├── subtitles.srt   (Phase 2 FFmpeg 폴백용)
    └── subtitles.json  (Remotion 컴포넌트용)
        [{text, startFrame, endFrame, words:[{text,startFrame,endFrame}]}]
        ※ 프레임 변환: frame = Math.round(ms / 1000 * 30)  ← 30fps 기준
```

**완료 체크:**
- `audio.mp3` 생성 확인
- `subtitles.json` 생성, 첫 줄 startFrame이 실제 오디오 시작과 일치하는지 육안 확인
- Windows Media Player로 음성 재생하면서 subtitles.json 타임코드 대조

---

### Phase 0-J: Conductor 조립 + 통합 테스트
> 모든 조각을 파이프라인으로 연결

| 파일 | 할 일 | 상태 |
|------|--------|------|
| `conductor.js` | A1→V1→A3→V3→A4→V4 루프 + 재시도(3회) + 사람 게이트 + 재개 로직 | ⬜ |

**완료 체크 (4가지):**
1. `node conductor.js "미국 금리 인하 전망"` → 끝까지 실행, `audio.mp3` 생성
2. 중간에 Ctrl+C → 재실행 → 마지막 완료 단계 이후부터 재개
3. V1에 강제 FAIL → 3회 후 escalate 메시지 출력
4. 사람 게이트에서 `n` 입력 → 피드백 반영 후 재시도

---

## Phase 1 — 자동 검증 추가
> 목표: 팩트·글자수를 코드+LLM이 1차 걸러낸다. 사람은 이상한 것만 본다.
> 선행조건: Phase 0이 **2주 이상** 안정적으로 동작

### Phase 1-A: V1 팩트체커 강화
| 작업 | 내용 |
|------|------|
| URL 실존 검사 | `fetch HEAD` 요청으로 source_url 200 응답 확인 |
| 날짜 신선도 검사 | 시장 데이터는 30일 이내, 초과 시 FAIL + 재수집 요청 |
| LLM 환각 대조 | Claude가 source_url 본문 fetch → claim 수치와 대조 |

### Phase 1-B: V3 대본 팩트체크 강화
| 작업 | 내용 |
|------|------|
| 원본 대조 | A1 claims vs A3 대본 수치 일치 여부 LLM 판단 |
| 톤 검사 | CANON 금기 표현 포함 여부 코드 검사 (정규식) |
| TTS 가독성 검사 | 괄호·슬래시·이모지 포함 여부 코드 검사 |

---

## Phase 2 — 비주얼 + 렌더 추가
> 목표: `audio.mp3` → `video.mp4` 자동 생성.
> 선행조건: Phase 1이 안정적으로 동작

### Phase 2-A: 구성 에이전트
| 파일 | 내용 |
|------|------|
| `agents/a2-structure.js` | beats[] 생성 (Hook + 기승전결 비트시트) |
| `verifiers/v2-structure-check.js` | 후킹 존재, 러닝타임 범위, 감정 아크, CANON 적합성 |
| 사람 승인 #1 추가 | V2 통과 후 beats를 사람이 확인 → 이후 대본·음성·영상 진행 |

### Phase 2-B: 비주얼 에이전트
| 파일 | 내용 |
|------|------|
| `agents/a5-visual.js` | 정지이미지: ChatGPT/Gemini, 영상클립: Veo. 차트는 AI 생성 금지 → 코드로 그림 |
| `verifiers/v5-visual-check.js` | 비전 LLM: 이미지↔비트 내용 일치, 브랜드 일관성, 아티팩트 없음 |

### Phase 2-C: 렌더 에이전트 + 자막 싱크

#### C-1. Remotion 자막 컴포넌트
| 파일 | 내용 |
|------|------|
| `remotion/components/Subtitle.jsx` | 프레임별 자막 표시 컴포넌트 |
| `remotion/components/WordHighlight.jsx` | 현재 발화 단어 하이라이트 (쇼츠 스타일) |

**Subtitle 컴포넌트 동작:**
```
subtitles.json 읽기
→ useCurrentFrame()으로 현재 프레임 감지
→ startFrame ≤ 현재프레임 ≤ endFrame 인 줄 표시
→ words[] 중 현재 단어는 노란색 하이라이트

레이아웃 분기:
  숏폼(9:16): 화면 하단 20%, 큰 폰트(28~32px), 중앙 정렬
  롱폼(16:9): 화면 하단 10%, 일반 폰트(20~24px), 좌측 정렬
```

#### C-2. 렌더 에이전트
| 파일 | 내용 |
|------|------|
| `agents/a6-render.js` | Remotion으로 audio + assets + Subtitle 컴포넌트 합성 → `video.mp4` |

**싱크 최종 검증 (렌더 후):**
```
1. FFmpeg로 영상 샘플 프레임 추출 (1초 간격)
2. 각 프레임의 자막 텍스트 OCR or 육안 확인
3. 오디오 파형과 자막 전환 시점 비교
   → 허용 오차: ±1프레임 (≒33ms at 30fps)
```

| 파일 | 내용 |
|------|------|
| `verifiers/v6-render-check.js` | FFmpeg: 유효 MP4, 오디오=영상 길이, 해상도, 자막 타이밍 일치 확인 |

---

## Phase 3 — 자동화 심화 + 안전장치
> 목표: 30~50편 이력 후 사람 개입 최소화.
> 선행조건: Phase 2 완료 + 충분한 이력 데이터. **H2(구성 승인)는 50편 전엔 자동화 금지.**

### Phase 3-A: 종단 검사
| 파일 | 내용 |
|------|------|
| `agents/m1-final-check.js` | 영상 전체 vs 최초 주제·CANON 비교, 단계별 오류 누적 점검 |

### Phase 3-B: 신뢰 게이트
| 파일 | 내용 |
|------|------|
| `lib/risk-scorer.js` | 수치 많음·강한 주장 = 높은 위험도. 낮으면 사람 승인 건너뜀 |
| `lib/confidence-gate.js` | Verifier 확신도 임계값 초과 시 자동 통과 |
| `lib/calibration-logger.js` | Verifier 판단 vs 사람 판단 기록 → 어느 유형을 자동화해도 되는지 판별 |

### Phase 3-C: 업로드 후 모니터링
| 파일 | 내용 |
|------|------|
| `lib/canary-checker.js` | 업로드 직후 조회수·이탈률 감시 → 이상 지표 시 자동 비공개 제안 |

---

## 핵심 설계 결정

| 결정 | 이유 |
|---|---|
| 모든 검증 = Node.js | Python이 사실상 없음 (0바이트 stub) |
| A1 = Gemini 2.5 Pro + `googleSearch` | 실시간 검색 + 출처 URL 자동 반환 → 환각 차단 |
| A3 = Anthropic SDK 직접 호출 | Conductor와 별개 인스턴스 유지 (자기검증 금지 규칙) |
| A4 = ElevenLabs `/with-timestamps` | 오디오 + 단어별 타이밍을 한 번에 → Phase 2 자막 싱크 준비 |
| 오디오 검증 = FFmpeg | 이미 설치됨. 파일 길이·무음·코덱 모두 검사 가능 |
| state.json 원자적 쓰기 | `.tmp` 파일에 쓴 뒤 rename → NTFS에서 원자적. 중간 종료 시 손상 방지 |
| 에피소드 ID = 날짜+주제해시 | 같은 주제 재실행 시 재개, 다른 날 새 에피소드 |
| Human gate = verifier 통과 + 사람 OK 모두 필요 | 어느 한 쪽만 완료된 채 종료돼도 재개 시 사람 확인 재요청 |

---

## state.json 스키마

```json
{
  "episode_id": "ep-20260612-0001",
  "topic": "영상 주제",
  "phase": 0,
  "stages": {
    "research": {
      "status": "verified",
      "attempts": 1,
      "human_approved": true,
      "decision_log": "...",
      "payload": { "claims": [] },
      "verifier_output": { "passed": true, "reasons": [] }
    },
    "script": { "status": "pending" },
    "voice":  { "status": "pending" }
  },
  "escalations": [],
  "final_approved": false
}
```

---

## Conductor 파이프라인 루프 (Phase 0)

```javascript
const PIPELINE = [
  { name: "research", producer: runA1, verifier: runV1, inputFrom: null },
  { name: "script",   producer: runA3, verifier: runV3, inputFrom: "research" },
  { name: "voice",    producer: runA4, verifier: runV4, inputFrom: "script" },
];

for (const stage of PIPELINE) {
  if (state.isStageComplete(stage.name)) continue;  // 재개 시 건너뜀

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const out = await stage.producer({ input: prev, canon, feedback });
    const result = await stage.verifier({ produced: out.payload, canon }); // 별개 인스턴스
    if (result.passed) { state.markVerified(stage.name, result); break; }
    feedback = result.reasons;
  }
  // 3회 실패 → escalate_to_human()

  const { approved, feedback: hFeedback } = await humanApprove(stage.name, payload);
  if (!approved) { /* 피드백으로 재시도 */ continue; }
  state.markHumanApproved(stage.name);
}
```

---

## Phase 0 검증 기준 (스텁 버전)

**V1 Research (코드):** claims[] 각 항목에 source_url, source_date, value 필드 존재 여부
**V3 Script (코드):** 총 글자수가 목표 초 × 4.7자/초의 ±10% 범위인지, 각 줄이 60자 이하인지
**V4 Voice (코드):** audio.mp3 파일 존재 + FFmpeg probe로 길이 확인 (script 추정치 ±20%)

LLM 판단은 Phase 1 이후 추가.

---

## 에이전트 핵심 구현

### A1 Research (Gemini)
- `tools: [{ googleSearch: {} }]` — 실시간 검색 그라운딩 활성화
- `responseMimeType: "application/json"` — 구조화 출력 강제
- `temperature: 0.2` — 팩트 정확도 우선
- 피드백(이전 V1 실패 이유)은 프롬프트 앞에 블록으로 삽입

### A3 Script (Claude API)
- `model: "claude-opus-4-8"` — 고품질 한국어 내레이션
- 글자수는 모델 자기보고를 신뢰하지 말고 Conductor 코드가 직접 계산
- beats 없을 시(Phase 0) 모델이 자체 구성 후 대본 작성 지시

### A4 Voice (ElevenLabs)
- `/with-timestamps` 엔드포인트 — 오디오 + 단어별 타이밍 한 번에
- 오디오는 즉시 디스크에 저장 (메모리 보존)
- `duration_seconds`는 V4의 FFmpeg probe가 채움 (에이전트 자기보고 신뢰 안 함)

---

## Human Gate UI

CLI `readline` 기반:
- 각 스테이지 결과를 포맷팅하여 출력 (claims 목록, 대본 줄별, 오디오 파일 경로)
- 음성 체크포인트에서 `start "audio.mp3"` 명령어 제시 (Windows 기본 플레이어)
- `y` 승인 / `n` 거부+피드백 입력 / `q` 종료 (state는 보존)

---

## 재시작(Resume) 동작

| 종료 시점 | 디스크 상태 | 재개 동작 |
|---|---|---|
| A1 API 호출 중 | in_progress, payload 없음 | A1 처음부터 재실행 |
| V1 전 A1 완료 | produced, payload 저장됨 | V1만 재실행 (Gemini 미재호출) |
| V1 통과 후 사람 승인 전 | verified, human_approved=false | 사람 승인 게이트만 재표시 |
| 사람 승인 완료 | verified, human_approved=true | 다음 단계로 스킵 |

---

## Phase 1 → 2 → 3 마이그레이션 경로

- **Phase 1:** `v1-research-check.js`, `v3-script-check.js`의 스텁을 실제 URL 검사 + LLM 팩트체크로 교체. `conductor.js` 변경 없음.
- **Phase 2:** `agents/a5-visual.js`, `agents/a6-render.js`, `verifiers/v5~v6` 추가. PIPELINE 배열에 항목 추가.
- **Phase 3:** M1 최종검사, Risk Scorer, Canary Checker 추가.

---

## 검증 방법 (Phase 0 완료 기준)

1. `node conductor.js "Fed 금리 인하와 환율"` 실행
2. A1이 claims JSON을 출력하고 사람 승인 게이트 표시
3. 승인 → A3가 대본 출력하고 승인 게이트
4. 승인 → A4가 audio.mp3 생성하고 승인 게이트
5. 전체 완료 후 `output/ep-YYYYMMDD-XXXX/` 폴더에 `state.json`, `audio.mp3` 존재 확인
6. 중간에 Ctrl+C 종료 후 동일 명령어 재실행 → 마지막 완료 단계 이후부터 재개되는지 확인
7. A1에서 의도적으로 오류 발생 → 3회 후 escalate 메시지 출력 확인

---

## CANON.md 채널 설정 (완료)

| 항목 | 결정값 |
|------|--------|
| 채널 정체성 | 날카로운 시사·경제 비평 채널 |
| 타겟 시청자 | 30~45세 직장인, 투자 입문자 |
| 톤앤매너 | 직접적·단정적, 다소 열정적, 팩트가 무기 |
| 페르소나 | 스마트한 동료가 설명해주는 스타일 |
| 금기 | 종목 추천, 루머·음모론, 동기부여 클리셰, 정치 편향 |
| 포맷 | 숏폼(50~90초) 주력 + 롱폼(5~10분) 병행 |

---

## 사전 확인 완료

- **API 키:** Gemini, Anthropic, ElevenLabs 모두 보유
- **CANON.md:** 작성 완료 (`E:\클로드프로젝트_0612\CANON.md`)
- **다음 단계:** `.env` 파일에 API 키 입력 후 구현 시작
