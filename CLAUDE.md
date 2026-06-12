# CLAUDE.md — 유튜브 영상 자동제작 하네스

> Claude Code가 이 파일을 읽고 영상 1편을 생산한다.
> 너(Claude Code)는 **Conductor**다. 아래 에이전트들을 순서대로 호출하고, 각 단계의 Gate를 통과시킨 뒤 다음으로 넘긴다.

---

## 0. 핵심 규칙 (먼저 읽어라)

1. **Verifier는 Producer와 별개 인스턴스**로 호출한다. 같은 에이전트가 자기 결과를 검사하게 하지 마라. Verifier 프롬프트에는 "결함을 찾아내라"는 적대적 지시를 넣는다.
2. **검증은 코드 우선**. 글자수·파일존재·길이·싱크·포맷은 Python으로 검사한다. LLM은 팩트·후킹·톤 판단에만 쓴다.
3. **Gate 로직**: `PASS → 다음 단계` / `FAIL → 피드백과 함께 Producer 재호출` / `FAIL이 MAX회(=3) 누적 → 중단하고 사람 호출`.
4. **CANON.md를 모든 에이전트에 함께 전달**한다. (채널 톤·페르소나·금기·이번 편 의도가 적힌 파일. §5 참고)
5. **상태는 state.json에 저장**한다. 단계마다 읽고 쓴다. 중간에 죽으면 죽은 단계부터 재개한다.
6. 렌더 엔진은 **HyperFrames 또는 Remotion 중 하나만** 쓴다. 둘 다 쓰지 마라.

---

## 1. 전체 흐름

```
[사람: 주제 입력]
   → A1 리서치  → V1 검사 → Gate
   → A2 구성    → V2 검사 → Gate → [사람: 구성 승인]
   → A3 대본    → V3 검사 → Gate
   → A4 음성    → V4 검사 → Gate
   → A5 비주얼  → V5 검사 → Gate
   → A6 렌더    → V6 검사 → Gate
   → M1 최종검사
   → [사람: 최종 승인] → 업로드
```

사람이 개입하는 지점은 **3곳뿐**: 주제 입력(시작) / 구성 승인(중간) / 최종 승인(끝).

---

## 2. 에이전트 명세

각 에이전트는 `입력 → 출력`이며, Gate의 `통과조건`을 만족해야 다음으로 넘어간다.

### A1 — 리서치
- **할 일**: 주제에 맞는 경제 데이터·뉴스·통계 수집
- **도구**: Gemini(실시간 검색 우선), 보조로 Claude/ChatGPT
- **입력**: 주제 1줄 + CANON
- **출력**: `claims[]` (각 항목 = 주장 텍스트 + 수치 + 출처 URL + 출처 날짜)

### V1 — 리서치 검사 (팩트체커) ★최우선
- **코드 검사**: 모든 수치에 출처 URL이 있는가 / 출처 날짜가 신선도 기준 내인가(시장데이터 30일)
- **LLM 검사**: 수치가 출처 원문과 일치하는가(환각 차단) / 출처가 신뢰 가능한가
- **통과조건**: 미검증 주장 0개
- **불통과 시**: 플래그된 주장만 A1이 재수집

### A2 — 구성
- **할 일**: 영상 구조 설계 (Hook + 기승전결 비트시트)
- **도구**: Claude
- **입력**: V1 통과한 claims + CANON
- **출력**: `beats[]` (비트별 목적·내용·예상초)

### V2 — 구성 검사
- **LLM 검사**: 첫 비트에 후킹이 있는가 / 각 비트가 결말로 전진하는가 / 감정 아크가 있는가 / 데이터가 스토리로 녹았는가 / CANON의 페르소나·포맷에 맞는가
- **코드 검사**: 비트 수·예상 러닝타임이 목표 범위인가
- **통과조건**: 위 항목 전부 PASS
- **불통과 시**: A2 재설계

### ⏸ 사람 승인 #1 (구성)
- V2 통과본을 사람에게 보여주고 OK를 받는다. **하류 작업(대본·음성·영상) 전에 여기서 멈춘다.**
- 초기 30~50편은 항상 사람 확인. 이후 신뢰게이트(§4)로 일부 자동화.

### A3 — 대본
- **할 일**: 승인된 beats로 내레이션 집필
- **도구**: Claude(주), ChatGPT(대안)
- **입력**: 승인된 beats + V1 claims + CANON
- **출력**: `script` (줄 단위, 각 줄은 TTS 호흡 길이)

### V3 — 대본 검사
- **코드 검사**: 총 글자수가 목표 ±10%인가(1분≒280자) / 각 줄이 호흡 길이 내인가
- **LLM 검사**: 대본이 V1 claims를 왜곡·날조하지 않았는가(**원본 대조 필수**) / 톤이 CANON과 맞는가 / 첫 3초에 후킹이 있는가 / TTS가 읽기 어려운 표현은 없는가
- **통과조건**: 글자수 OK + 팩트 왜곡 0
- **불통과 시**: 플래그된 줄만 A3 수정

### A4 — 음성
- **할 일**: script를 TTS로 변환
- **도구**: ElevenLabs
- **입력**: script
- **출력**: `audio.mp3` + 구간별 타임스탬프

### V4 — 음성 검사
- **코드 검사**: 파일 생성됨 / 길이가 script 추정치와 일치 / 무음·클리핑 없음
- **LLM 검사 (STT 역검증)**: 생성된 오디오를 STT로 받아쓰기 → script와 대조. 숫자·영어단어·연도 오독을 잡는다.
- **통과조건**: STT 대조 불일치 0
- **불통과 시**: 해당 구간 SSML 발음 수정 후 A4 재생성

### A5 — 비주얼
- **할 일**: 비트별 이미지·영상 소스 생성
- **도구**: 정지이미지=ChatGPT/Gemini, 영상클립=Veo. **데이터 차트는 이미지생성 금지 → A6에서 코드로 그린다**(AI 이미지는 숫자를 틀리게 그림)
- **입력**: beats + script
- **출력**: `assets[]` (비트ID ↔ 파일 매핑)

### V5 — 비주얼 검사
- **코드 검사**: 모든 비트에 asset이 배정됐는가
- **LLM(비전) 검사**: 이미지가 비트 내용과 맞는가 / 차트 속 숫자가 claims와 일치하는가 / 브랜드 일관성 / 깨진 글자·아티팩트 없는가
- **통과조건**: 비전 검사 전부 PASS
- **불통과 시**: 해당 asset만 A5 재생성

### A6 — 렌더
- **할 일**: audio + assets + 자막 + 타이밍을 합쳐 영상 출력
- **도구**: HyperFrames 또는 Remotion (택1)
- **입력**: audio.mp3 + assets + script(자막용) + 타임스탬프
- **출력**: `video.mp4`

### V6 — 렌더 검사
- **코드 검사**: 렌더 완료·유효 MP4·손상프레임 없음 / 오디오길이=영상길이 / 해상도·포맷 맞음(16:9 또는 9:16) / 자막 존재·타이밍 일치
- **LLM(비전) 검사**: 샘플 프레임 글리치 점검
- **통과조건**: 코드 검사 전부 PASS
- **불통과 시**: A6 재렌더 / 합성 코드 수정

### M1 — 최종 검사 (종단)
- **입력**: video.mp4 + CANON + 최초 주제
- **LLM 검사**: 영상이 최초 주제·CANON 의도를 이행했는가 / 페르소나가 처음~끝 일관됐는가 / 화면 숫자가 claims와 최종 일치하는가(단계별 오류 누적 점검)
- **통과조건**: 전부 PASS → 사람 승인 #2로
- **불통과 시**: 어느 단계 문제인지 지목하고 사람 호출

### ⏸ 사람 승인 #2 (최종)
- M1 통과 시 사람이 최종 확인. CapCut 수동 마감은 선택.
- 자동화를 더 줄이려면 §4의 Canary로 대체.

---

## 3. 단계 간 데이터 형식 (계약)

모든 에이전트는 이전 단계의 JSON을 읽고 자기 JSON을 쓴다. 공통 골격:

```json
{
  "stage": "research",
  "status": "verified",
  "attempts": 1,
  "decision_log": "냉소적 톤 선택. 이유: 타겟이 동기부여 클리셰에 피로",
  "payload": { }
}
```

- `decision_log`: **이 단계에서 내린 판단의 이유**를 적는다. 다음 에이전트가 의도를 잃지 않게 하는 핵심 필드. 비우지 마라.
- `payload`: 단계별 실제 산출물 (claims / beats / script / audio경로 / assets / video경로).

예시 — A1 출력:
```json
{
  "stage": "research", "status": "verified", "attempts": 1,
  "decision_log": "금리 인하 전망 중심으로 수집. 최신 FOMC 발언 반영",
  "payload": {
    "claims": [
      {"text": "...", "value": "5.2%", "source_url": "https://...", "source_date": "2026-06-10", "verified": true}
    ]
  }
}
```

---

## 4. 사람 줄이기 (데이터 쌓인 뒤)

초기엔 위 3개 사람지점을 모두 유지한다. 통과/반려 이력이 쌓이면 아래를 켠다.

| 보조 에이전트 | 역할 |
|---|---|
| Risk Scorer | 산출물에 위험점수 부여(수치 많음·주장 셈) → 점수 낮으면 사람 건너뜀 |
| Confidence Gate | Verifier 확신도가 임계값 넘으면 사람 승인 자동 통과 |
| Calibration Logger | Verifier 판단 vs 사람 판단을 기록 → 어떤 유형을 자동화해도 되는지 판별 |
| Canary Checker | 업로드 직후 지표 감시 → 이상하면 자동 비공개 제안 |

규칙: **H2(구성 승인)는 30~50편 전엔 자동화하지 마라.** 페르소나 정답 데이터가 없으면 표류한다.

---

## 5. CANON.md (별도 파일로 만들 것)

모든 에이전트에 매번 함께 전달하는 단일 기준 문서. 아래 항목을 채운다.

```
- 채널 정체성: (예: 냉철한 현실파 경제 채널)
- 타겟 시청자:
- 톤앤매너: (말투·온도)
- 페르소나: (화자가 누구인 척하는가)
- 금기: (하면 안 되는 표현·주제)
- 포맷: (롱폼/숏폼, 목표 길이)
- 이번 편 의도: (이 영상으로 시청자가 뭘 느끼고 뭘 하길 바라는가)
```

Conductor는 매 에이전트 호출 시 `[에이전트 입력] + CANON.md`를 함께 넘긴다.

---

## 6. 구현 순서 (Phase) — 한 번에 다 만들지 마라

각 Phase가 2주 이상 안정적으로 돈 뒤 다음으로 간다.

| Phase | 만드는 것 | 확인할 것 |
|---|---|---|
| 0 | A1 + A3 + A4 (리서치→대본→음성), 검사는 전부 사람 | 사슬이 안 끊기고 도는가 |
| 1 | + V1(코드검사만) + V3 | 검사 붙여도 안정적인가 |
| 2 | + A5 + A6 (렌더 1개) | 영상이 끝까지 나오는가 |
| 3 | + M1 + 신뢰게이트 + Canary | 사람 줄여도 품질 유지되는가 |

**Phase 0부터 시작한다.** A1+A3+A4 사슬 하나가 안정적으로 도는 것부터 확인하고, 그 다음에 검사를 붙인다.

---

## 7. 의사코드 (Conductor 메인 루프)

```python
def produce_video(topic):
    canon = load("CANON.md")
    state = load_or_init("state.json", topic)

    pipeline = [
        ("research", A1, V1, human=False),
        ("structure", A2, V2, human=True),   # 사람 승인 #1
        ("script",   A3, V3, human=False),
        ("voice",    A4, V4, human=False),
        ("visual",   A5, V5, human=False),
        ("render",   A6, V6, human=False),
    ]

    for name, producer, verifier, human in pipeline:
        if state.done(name):
            continue
        prev = state.last_payload()
        for attempt in range(1, MAX+1):     # MAX = 3
            out = producer(input=prev, canon=canon)
            result = verifier(out, canon=canon)   # 별개 인스턴스
            if result.passed:
                state.save(name, out); break
            prev = out.with_feedback(result.reasons)
        else:
            escalate_to_human(name, result); return   # 3회 실패 → 중단

        if human:
            if not human_approve(name, state):         # 사람 승인 대기
                escalate_to_human(name, state); return

    if not M1(state.video, canon, topic).passed:
        escalate_to_human("final", state); return

    if human_approve("final", state):
        upload(state.video)
```

---

## 요약 (한 줄)

**사람이 주제만 주면, A1~A6 에이전트가 리서치→대본→음성→영상을 만들고, V1~V6 검사 에이전트가 각 단계를 걸러내며, 사람은 주제·구성·최종 3곳만 승인하는 시스템. CANON으로 톤을 고정하고, Conductor(=Claude Code)가 state.json으로 전 과정을 통제한다.**
