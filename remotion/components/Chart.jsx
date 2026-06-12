/**
 * Chart — 데이터 차트 컴포넌트 (@visx/shape 기반)
 * AI 이미지 생성 절대 금지 — 숫자 오류 방지를 위해 코드로 직접 렌더링한다.
 * 지원 타입: "bar" | "line" | "area"
 */

import { Bar } from "@visx/shape";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";

const COLORS = {
  bar: "#4ECDC4",
  label: "white",
  axis: "rgba(255,255,255,0.35)",
  title: "white",
  value: "#F8F8F8",
};

/**
 * @param {{ spec: { title, type, unit, data: {label, value}[] }, width, height }} props
 */
export const Chart = ({ spec, width = 1000, height = 760 }) => {
  if (!spec || !Array.isArray(spec.data) || spec.data.length === 0) {
    return null;
  }

  const { title = "", unit = "", data } = spec;
  const margin = { top: 70, right: 30, bottom: 70, left: 90 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const minVal = Math.min(...data.map((d) => d.value));
  const maxVal = Math.max(...data.map((d) => d.value));
  const yPad  = (maxVal - minVal) * 0.18 || maxVal * 0.18 || 1;

  const xScale = scaleBand({
    domain: data.map((d) => d.label),
    range: [0, innerW],
    padding: 0.35,
  });

  const yScale = scaleLinear({
    domain: [Math.max(0, minVal - yPad), maxVal + yPad],
    range: [innerH, 0],
    nice: true,
  });

  return (
    <div style={{ color: COLORS.title }}>
      {title && (
        <p
          style={{
            textAlign: "center",
            fontSize: 38,
            fontWeight: 800,
            marginBottom: 8,
            fontFamily: "'Noto Sans KR', sans-serif",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </p>
      )}

      <svg width={width} height={height} style={{ overflow: "visible" }}>
        <Group left={margin.left} top={margin.top}>
          {/* 가로 기준선 */}
          {yScale.ticks(4).map((tick) => (
            <line
              key={tick}
              x1={0} x2={innerW}
              y1={yScale(tick)} y2={yScale(tick)}
              stroke="rgba(255,255,255,0.12)"
              strokeDasharray="4 4"
            />
          ))}

          {/* 막대 */}
          {data.map((d) => {
            const x = xScale(d.label) ?? 0;
            const y = yScale(d.value) ?? 0;
            const bw = xScale.bandwidth();
            const bh = innerH - (yScale(d.value) ?? 0);

            return (
              <g key={d.label}>
                <Bar x={x} y={y} width={bw} height={bh} fill={COLORS.bar} rx={5} />
                {/* 값 라벨 */}
                <text
                  x={x + bw / 2}
                  y={y - 10}
                  fill={COLORS.value}
                  fontSize={28}
                  textAnchor="middle"
                  fontWeight="700"
                  fontFamily="'Noto Sans KR', sans-serif"
                >
                  {d.value}
                  {unit}
                </text>
              </g>
            );
          })}

          <AxisBottom
            scale={xScale}
            top={innerH}
            tickLabelProps={() => ({
              fill: COLORS.label,
              fontSize: 26,
              textAnchor: "middle",
              fontFamily: "'Noto Sans KR', sans-serif",
            })}
            stroke={COLORS.axis}
            tickStroke={COLORS.axis}
          />

          <AxisLeft
            scale={yScale}
            numTicks={4}
            tickLabelProps={() => ({
              fill: COLORS.label,
              fontSize: 22,
              dx: -8,
              dy: 4,
              fontFamily: "'Noto Sans KR', sans-serif",
            })}
            stroke={COLORS.axis}
            tickStroke={COLORS.axis}
            tickFormat={(v) => `${v}${unit}`}
          />
        </Group>
      </svg>
    </div>
  );
};
