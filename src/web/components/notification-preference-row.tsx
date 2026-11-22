import type { NotificationPreferenceKey } from "../../shared/notifications.ts";
import { PreferenceSwitch } from "./preference-switch.tsx";

export function PreferenceRow({
  checked,
  detail,
  disabled,
  id,
  label,
  onToggle,
}: {
  checked: boolean;
  detail: string;
  disabled: boolean;
  id: NotificationPreferenceKey;
  label: string;
  onToggle: (kind: NotificationPreferenceKey, enabled: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[12.5px] text-muted-foreground">{detail}</p>
      </div>
      <PreferenceSwitch
        checked={checked}
        disabled={disabled}
        label={label}
        onToggle={() => {
          onToggle(id, !checked);
        }}
      />
    </div>
  );
}
