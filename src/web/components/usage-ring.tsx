import { copy } from "../../shared/copy.ts";
import { useHomeData } from "../lib/home-api.ts";

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function UsageRing() {
  const { data } = useHomeData();
  const left = data?.applicationsLeft ?? 0;
  const plan = data?.planApplications ?? 0;
  const share = plan > 0 ? Math.min(1, Math.max(0, (plan - left) / plan)) : 0;

  return (
    <div className="relative h-11 w-11">
      <span className="sr-only">{copy.home.usageAria(left)}</span>
      <svg aria-hidden="true" className="h-11 w-11" viewBox="0 0 44 44">
        <circle
          cx="22"
          cy="22"
          fill="none"
          r={RADIUS}
          stroke="var(--color-border)"
          strokeWidth="1.5"
        />
        <circle
          cx="22"
          cy="22"
          fill="none"
          r={RADIUS}
          stroke="var(--color-signal)"
          strokeDasharray={`${String(share * CIRCUMFERENCE)} ${String(CIRCUMFERENCE)}`}
          strokeDashoffset="0"
          strokeLinecap="round"
          strokeWidth="2"
          transform="rotate(-90 22 22)"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-xs font-semibold tabular-nums text-foreground">
        {copy.home.usageCount(left)}
      </span>
    </div>
  );
}
