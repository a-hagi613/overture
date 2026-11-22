import { Link } from "react-router";

export function SettingsLegalRow({
  detail,
  label,
  linkText,
  to,
}: {
  detail: string;
  label: string;
  linkText: string;
  to: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border py-3.5 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[12.5px] text-muted-foreground">{detail}</p>
      </div>
      <Link
        className="group inline-flex h-9 flex-none items-center justify-center max-md:h-11 max-md:-my-[4px]"
        to={to}
      >
        <span className="inline-flex h-9 items-center justify-center rounded-md border border-input px-3.5 text-[13px] font-semibold group-hover:bg-muted">
          {linkText}
        </span>
      </Link>
    </div>
  );
}
