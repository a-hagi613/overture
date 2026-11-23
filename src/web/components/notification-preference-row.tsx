import type { NotificationPreferenceKey } from "../../shared/notifications.ts";
import { Switch } from "./ui/switch.tsx";

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
    <div className="flex items-center justify-between gap-4 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      <Switch
        ariaLabel={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => {
          onToggle(id, next);
        }}
      />
    </div>
  );
}
