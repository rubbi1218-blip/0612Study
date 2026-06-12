/**
 * Episode — Remotion 메인 컴포지션 컴포넌트
 *
 * props:
 *   beats[]        - { id, startFrame, endFrame, ... }
 *   assets[]       - { beat_id, type, file_path?, chart_spec? }
 *   subtitleCues[] - { text, startFrame, endFrame }
 *   wordCues[]     - { word, startFrame, endFrame }
 *   audioPath      - string (audio.mp3 절대 경로)
 *   totalFrames    - number
 */

import { AbsoluteFill, Audio, Img, useCurrentFrame } from "remotion";
import { Subtitle } from "./components/Subtitle.jsx";
import { WordHighlight } from "./components/WordHighlight.jsx";
import { Chart } from "./components/Chart.jsx";

export const Episode = ({ beats = [], assets = [], subtitleCues = [], wordCues = [], audioPath = "" }) => {
  const frame = useCurrentFrame();

  const currentBeat  = beats.find((b) => frame >= b.startFrame && frame < b.endFrame);
  const currentAsset = assets.find((a) => a.beat_id === currentBeat?.id);
  const currentCue   = subtitleCues.find((c) => frame >= c.startFrame && frame <= c.endFrame);
  const currentWord  = wordCues.find((w) => frame >= w.startFrame && frame <= w.endFrame);

  return (
    <AbsoluteFill style={{ background: "#0a0a0a" }}>
      {/* 오디오 트랙 */}
      {audioPath && <Audio src={audioPath} />}

      {/* 배경 — 이미지 */}
      {currentAsset?.type === "image" && currentAsset.file_path && (
        <AbsoluteFill>
          <Img
            src={currentAsset.file_path}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <AbsoluteFill style={{ background: "rgba(0,0,0,0.38)" }} />
        </AbsoluteFill>
      )}

      {/* 배경 — 차트 (코드 렌더링, AI 이미지 절대 금지) */}
      {currentAsset?.type === "chart" && currentAsset.chart_spec && (
        <AbsoluteFill
          style={{
            background: "#111827",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "100px 40px 80px",
          }}
        >
          <Chart spec={currentAsset.chart_spec} width={1000} height={760} />
        </AbsoluteFill>
      )}

      {/* 현재 발화 단어 (상단) */}
      {currentWord && (
        <AbsoluteFill
          style={{
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 220,
          }}
        >
          <WordHighlight word={currentWord.word} />
        </AbsoluteFill>
      )}

      {/* 자막 (하단) */}
      {currentCue && (
        <AbsoluteFill
          style={{
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: 180,
          }}
        >
          <Subtitle text={currentCue.text} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
