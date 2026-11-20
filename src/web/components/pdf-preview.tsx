import { copy } from "../../shared/copy.ts";

type PdfBarKind = "bar" | "heading" | "name" | "rule";

interface PdfBar {
  kind: PdfBarKind;
  width?: string;
  wideMargin?: boolean;
}

const pdfBars: PdfBar[] = [
  { kind: "name", width: "44%" },
  { kind: "bar", width: "70%", wideMargin: true },
  { kind: "rule" },
  { kind: "heading", width: "22%" },
  { kind: "bar", width: "96%" },
  { kind: "bar", width: "92%" },
  { kind: "bar", width: "88%" },
  { kind: "bar", width: "58%" },
  { kind: "heading", width: "18%" },
  { kind: "bar", width: "94%" },
  { kind: "bar", width: "90%" },
  { kind: "bar", width: "70%" },
  { kind: "bar", width: "92%" },
  { kind: "bar", width: "62%" },
  { kind: "heading", width: "24%" },
  { kind: "bar", width: "90%" },
  { kind: "bar", width: "86%" },
  { kind: "bar", width: "94%" },
  { kind: "bar", width: "52%" },
  { kind: "heading", width: "14%" },
  { kind: "bar", width: "96%" },
  { kind: "bar", width: "74%" },
  { kind: "bar", width: "88%" },
];

function barClassName(kind: PdfBarKind) {
  if (kind === "bar") {
    return "mt-[5px] block h-1 rounded-[2px] bg-pdf-line tabular-nums";
  }

  if (kind === "heading") {
    return "mt-[15px] block h-[5px] rounded-[2px] bg-pdf-ink";
  }

  return "block h-2.5 rounded-[2px] bg-pdf-ink";
}

export function PdfPreview() {
  return (
    <div className="rounded-lg border border-border bg-muted pb-3.5 pl-5 pr-5 pt-5">
      <div
        aria-hidden="true"
        className="aspect-[8.5/11] w-full overflow-hidden rounded-[2px] bg-pdf px-[9%] pt-[9%] shadow-[0_1px_0_rgba(0,0,0,.08),0_14px_28px_-16px_var(--color-shadow-strong)]"
      >
        {pdfBars.map((bar) => {
          const name = `${bar.kind}-${bar.width ?? "rule"}`;

          if (bar.kind === "rule") {
            return <hr className="mt-[11px] border-pdf-line" key={name} />;
          }

          return (
            <i
              className={`${barClassName(bar.kind)} ${bar.wideMargin === true ? "mt-[9px]" : ""}`}
              key={name}
              style={{ width: bar.width }}
            />
          );
        })}
      </div>
      <div className="mt-3">
        <span className="text-[12px] leading-[1.5] text-muted-foreground tabular-nums">
          {copy.profile.resume.pageOf}
        </span>
      </div>
    </div>
  );
}
