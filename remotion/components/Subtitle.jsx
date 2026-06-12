/**
 * Subtitle — 자막 표시 컴포넌트
 * 자막 큐에서 현재 프레임에 해당하는 텍스트를 화면 하단에 렌더링한다.
 */

export const Subtitle = ({ text }) => {
  if (!text) return null;

  return (
    <div
      style={{
        color: "white",
        fontSize: 52,
        fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",
        fontWeight: 700,
        textAlign: "center",
        lineHeight: 1.35,
        textShadow: "0 2px 16px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.8)",
        maxWidth: 960,
        padding: "14px 28px",
        background: "rgba(0,0,0,0.52)",
        borderRadius: 10,
        backdropFilter: "blur(2px)",
      }}
    >
      {text}
    </div>
  );
};
