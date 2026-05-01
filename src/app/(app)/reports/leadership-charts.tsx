"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";

const CHANNEL_COLORS: Record<string, string> = {
  amazon_1p: "#1b2a3b",   // navy
  amazon_di: "#6479a0",   // steel
  domestic: "#b8c4d8",    // cloud
};

const CHANNEL_LABELS: Record<string, string> = {
  amazon_1p: "Amazon 1P",
  amazon_di: "Direct Import",
  domestic: "Domestic",
};

const CHANNEL_ORDER = ["amazon_1p", "amazon_di", "domestic"] as const;

export interface ChannelMonthly {
  month: string;       // e.g. "Nov 2025"
  amazon_1p: number;
  amazon_di: number;
  domestic: number;
}

interface ChartProps {
  data: ChannelMonthly[];
}

// 100% stacked bar — each month sums to 100%
export function ChannelMixChart({ data }: ChartProps) {
  // Normalize to percentages
  const normalized = data.map((row) => {
    const total = row.amazon_1p + row.amazon_di + row.domestic;
    if (total === 0) return { month: row.month, amazon_1p: 0, amazon_di: 0, domestic: 0 };
    return {
      month: row.month,
      amazon_1p: (row.amazon_1p / total) * 100,
      amazon_di: (row.amazon_di / total) * 100,
      domestic: (row.domestic / total) * 100,
    };
  });

  return (
    <div className="bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] px-6 py-5 h-full">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-text-tertiary)] mb-1">
        Channel Mix
      </p>
      <p className="text-xs text-[var(--c-text-tertiary)] mb-4">
        Share of revenue by channel, last {data.length} months
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={normalized} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11, fill: "var(--c-text-tertiary)" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--c-text-tertiary)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
              domain={[0, 100]}
            />
            <Tooltip
              contentStyle={{
                background: "var(--c-card-bg)",
                border: "1px solid var(--c-border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value) => `${Number(value).toFixed(1)}%`}
            />
            {CHANNEL_ORDER.map((key) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="mix"
                fill={CHANNEL_COLORS[key]}
                name={CHANNEL_LABELS[key]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-5 mt-3 flex-wrap">
        {CHANNEL_ORDER.map((key) => (
          <div key={key} className="flex items-center gap-2 text-xs text-[var(--c-text-secondary)]">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CHANNEL_COLORS[key] }} />
            {CHANNEL_LABELS[key]}
          </div>
        ))}
      </div>
    </div>
  );
}

// Multi-line trend chart — one line per channel
export function ChannelTrendChart({ data }: ChartProps) {
  return (
    <div className="bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] px-6 py-5 h-full">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-text-tertiary)] mb-1">
        Channel Trend
      </p>
      <p className="text-xs text-[var(--c-text-tertiary)] mb-4">
        Revenue per channel over time
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border-row)" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11, fill: "var(--c-text-tertiary)" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--c-text-tertiary)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`}
            />
            <Tooltip
              contentStyle={{
                background: "var(--c-card-bg)",
                border: "1px solid var(--c-border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value) => `$${Number(value).toLocaleString()}`}
            />
            <Legend
              iconType="square"
              iconSize={10}
              wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
              formatter={(name) => CHANNEL_LABELS[name] ?? name}
            />
            {CHANNEL_ORDER.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={CHANNEL_COLORS[key]}
                strokeWidth={2}
                dot={{ r: 3, fill: CHANNEL_COLORS[key] }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
