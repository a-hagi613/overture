import { ThemeToggle } from "../../components/theme-toggle.tsx";

export function AdminPageHeading({
  lead,
  plain,
  italic,
}: {
  lead: string;
  plain: string;
  italic: string;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="font-serif text-[15px] italic text-muted-foreground">{lead}</p>
        <h1 className="mt-0.5 font-serif text-[32px] leading-[1.05] md:text-[42px]">
          {plain}
          {italic.length === 0 ? null : (
            <>
              {" "}
              <span className="italic">{italic}</span>
            </>
          )}
        </h1>
      </div>
      <ThemeToggle
        compact
        className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-input bg-card hover:bg-muted"
      />
    </div>
  );
}
