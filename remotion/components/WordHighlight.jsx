/**
 * WordHighlight — 현재 발화 단어 하이라이트 컴포넌트 (쇼츠 스타일)
 * 단어 단위 타임스탬프로 현재 말하고 있는 단어를 강조한다.
 */

import { spring, useCurrentFrame, useVideoConfig } from "remotion";

export const WordHighlight = ({ word }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame, fps, config: { stiffness: 280, damping: 20 }, from: 0.7, to: 1 });

  if (!word) return null;

  return (
    <div
      style={{
        transform: `scale(${scale})`,
        color: "#FFD700",
        fontSize: 72,
        fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",
        fontWeight: 900,
        textAlign: "center",
        letterSpacing: "-0.02em",
        textShadow: "0 0 24px rgba(255,215,0,0.55), 0 2px 8px rgba(0,0,0,0.9)",
      }}
    >
      {word}
    </div>
  );
};
