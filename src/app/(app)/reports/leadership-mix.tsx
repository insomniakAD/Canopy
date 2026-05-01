interface TierMixProps {
  segments: { tier: string; pct: number; revenue: number }[];
}

const TIER_COLORS: Record<string, string> = {
  A: "#1b2a3b",
  B: "#6479a0",
  C: "#b8c4d8",
  LP: "#e2e8f2",
};

export function TierRevenueMixCard({ segments }: TierMixProps) {
  const total = segments.reduce((s, x) => s + x.pct, 0);
  const r = 50;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] px-6 py-5 h-full">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-text-tertiary)] mb-4">
        Tier Revenue Mix
      </p>
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <svg width="130" height="130" viewBox="0 0 130 130">
            <circle cx="65" cy="65" r={r} fill="none" stroke="var(--c-border)" strokeWidth={strokeWidth} />
            {segments.map((seg) => {
              const fraction = total > 0 ? seg.pct / total : 0;
              const dashLength = fraction * circumference;
              const segmentOffset = -offset;
              offset += dashLength;
              return (
                <circle
                  key={seg.tier}
                  cx="65"
                  cy="65"
                  r={r}
                  fill="none"
                  stroke={TIER_COLORS[seg.tier] ?? "var(--c-cloud)"}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dashLength} ${circumference}`}
                  strokeDashoffset={segmentOffset}
                  transform="rotate(-90 65 65)"
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xs text-[var(--c-text-tertiary)] tracking-wider">
              {segments.length} tiers
            </span>
          </div>
        </div>
        <div className="flex-1 space-y-2 text-sm">
          {segments.map((seg) => (
            <div key={seg.tier} className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS[seg.tier] ?? "var(--c-cloud)" }} />
                <span className="text-[var(--c-text-secondary)]">Tier {seg.tier}</span>
              </div>
              <span className="font-semibold text-[var(--c-text-primary)] tabular-nums">{seg.pct.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface FactoryConcentrationProps {
  rows: { factory: string; pct: number }[];
}

export function FactoryConcentrationCard({ rows }: FactoryConcentrationProps) {
  return (
    <div className="bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] px-6 py-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-text-tertiary)] mb-5">
        Factory Concentration
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--c-text-tertiary)]">No factory data yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 8).map((row, i) => (
            <div key={row.factory} className="grid grid-cols-[1fr_auto] items-center gap-4 text-sm">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[var(--c-text-secondary)] truncate w-40">{row.factory}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--c-border-row)] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(row.pct, 100)}%`,
                      backgroundColor: i === 0 ? "var(--c-ink)" : i < 3 ? "var(--c-steel)" : "var(--c-cloud)",
                    }}
                  />
                </div>
              </div>
              <span className="text-[var(--c-text-primary)] tabular-nums font-light w-12 text-right">
                {row.pct.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
