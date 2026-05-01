interface DoiPoint {
  skuCode: string;
  doi: number;
  target: number;
}

interface DoiDistributionCardProps {
  belowCount: number;
  onTargetCount: number;
  aboveCount: number;
}

const COLORS = {
  below: "var(--c-error)",
  onTarget: "var(--c-success)",
  above: "var(--c-cloud)",
};

export function DoiDistributionCard({ belowCount, onTargetCount, aboveCount }: DoiDistributionCardProps) {
  const total = belowCount + onTargetCount + aboveCount;
  const r = 60;
  const strokeWidth = 18;
  const circumference = 2 * Math.PI * r;

  const segments = total > 0 ? [
    { value: belowCount, color: COLORS.below },
    { value: onTargetCount, color: COLORS.onTarget },
    { value: aboveCount, color: COLORS.above },
  ] : [];

  let offset = 0;

  return (
    <div className="bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] px-6 py-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-text-tertiary)] mb-4">
        DOI Distribution
      </p>
      <div className="flex items-center gap-6">
        <div className="relative shrink-0">
          <svg width="160" height="160" viewBox="0 0 160 160">
            {/* Background ring */}
            <circle
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke="var(--c-border)"
              strokeWidth={strokeWidth}
            />
            {segments.map((seg, i) => {
              const fraction = seg.value / total;
              const dashLength = fraction * circumference;
              const segmentOffset = -offset;
              offset += dashLength;
              return (
                <circle
                  key={i}
                  cx="80"
                  cy="80"
                  r={r}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dashLength} ${circumference}`}
                  strokeDashoffset={segmentOffset}
                  transform="rotate(-90 80 80)"
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="font-extralight text-[2.25rem] leading-none text-[var(--c-text-primary)]">
              {total}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-[var(--c-text-tertiary)] mt-1">
              ASINs
            </span>
          </div>
        </div>

        <div className="flex-1 space-y-2.5 text-sm">
          <LegendRow color={COLORS.below} label="Below Target" value={belowCount} />
          <LegendRow color={COLORS.onTarget} label="On Target" value={onTargetCount} />
          <LegendRow color={COLORS.above} label="Above Target" value={aboveCount} />
        </div>
      </div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[var(--c-text-secondary)]">{label}</span>
      </div>
      <span className="font-semibold text-[var(--c-text-primary)] tabular-nums">{value}</span>
    </div>
  );
}

interface DoiVarianceBarsProps {
  points: DoiPoint[];
}

export function DoiVarianceBars({ points }: DoiVarianceBarsProps) {
  // Sort by ratio (lowest = most critical) and take top 8
  const sorted = [...points]
    .filter((p) => p.target > 0)
    .map((p) => ({ ...p, ratio: p.doi / p.target }))
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 8);

  return (
    <div className="bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] px-6 py-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-text-tertiary)] mb-1">
        Amazon DOI vs Target
      </p>
      <p className="text-xs text-[var(--c-text-tertiary)] mb-5">
        Sorted by variance (most critical first)
      </p>
      {sorted.length === 0 ? (
        <p className="text-sm text-[var(--c-text-tertiary)] py-4">No DOI data available.</p>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((p) => {
            const fillPct = Math.min(p.ratio * 100, 100);
            const isBelow = p.ratio < 0.9;
            const barColor = isBelow ? "var(--c-error)" : "var(--c-success)";
            return (
              <div key={p.skuCode} className="grid grid-cols-[80px_1fr_auto] items-center gap-3 text-sm">
                <span className="text-[var(--c-text-secondary)] tabular-nums truncate">{p.skuCode}</span>
                <div className="relative h-2 rounded-full bg-[var(--c-border-row)] overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all"
                    style={{ width: `${fillPct}%`, backgroundColor: barColor }}
                  />
                </div>
                <span className="text-xs tabular-nums whitespace-nowrap">
                  <span className={isBelow ? "text-[var(--c-error)] font-semibold" : "text-[var(--c-text-primary)]"}>
                    {p.doi.toFixed(1)}d
                  </span>
                  <span className="text-[var(--c-text-tertiary)]"> / {p.target}d</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
