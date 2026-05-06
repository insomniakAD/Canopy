"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";

export type SparklineProps = {
  data: number[];
  polarity?: "good" | "bad" | "neutral";
  height?: number;
};

const COLORS = {
  good: { stroke: "var(--c-trend-up)", fill: "var(--c-trend-up-fill)" },
  bad: { stroke: "var(--c-trend-down)", fill: "var(--c-trend-down-fill)" },
  neutral: { stroke: "var(--c-trend-neutral)", fill: "transparent" },
};

export function Sparkline({ data, polarity = "neutral", height = 36 }: SparklineProps) {
  if (data.length === 0) return null;
  const points = data.map((v, i) => ({ i, v }));
  const colors = COLORS[polarity];
  const gradientId = `spark-grad-${polarity}-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div style={{ width: "100%", height }} aria-hidden>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.stroke} stopOpacity={0.28} />
              <stop offset="100%" stopColor={colors.stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={colors.stroke}
            strokeWidth={1.5}
            fill={polarity === "neutral" ? "transparent" : `url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
