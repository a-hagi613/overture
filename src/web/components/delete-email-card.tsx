import { copy } from "../../shared/copy.ts";

const cardClass =
  "flex flex-col rounded-lg border border-border bg-card p-[20px_16px_22px] shadow-sh min-[768px]:p-[24px_28px_26px]";

const headingClass = "font-serif text-[28px] leading-[1.1]";

export function DeleteEmailCard({ name }: { name: string }) {
  return (
    <section
      aria-labelledby="delete-email-heading"
      className={cardClass}
      data-testid="delete-email"
    >
      <h2 className={headingClass} id="delete-email-heading">
        {copy.deleteAccount.emailHeading}
      </h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-input bg-card">
        <div className="border-b border-border px-4 py-3 text-[12.5px] text-muted-foreground">
          <div>
            <strong className="text-foreground">{copy.deleteAccount.emailFromLabel}</strong>{" "}
            {copy.deleteAccount.emailFrom}
          </div>
          <div>
            <strong className="text-foreground">{copy.deleteAccount.emailSubjectLabel}</strong>{" "}
            {copy.deleteAccount.emailSubject}
          </div>
        </div>
        <div className="p-4 text-[14px] leading-[1.6]">
          <p>{copy.deleteAccount.emailHi(name)}</p>
          <p className="mt-2.5">{copy.deleteAccount.emailBody}</p>
          <p className="mt-2.5">{copy.deleteAccount.emailContact}</p>
          <p className="mt-2.5 text-muted-foreground">{copy.deleteAccount.emailSignoff}</p>
        </div>
      </div>
    </section>
  );
}
