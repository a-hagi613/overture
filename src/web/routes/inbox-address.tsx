import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { useMailbox } from "../lib/inbox-api.ts";
import { InboxSteps } from "../components/inbox-steps.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { dateLine } from "../lib/inbox-time.ts";
import { NavGlyph } from "../components/nav-glyph.tsx";

export function InboxAddressPage() {
  const { data, isError, isPending, refetch } = useMailbox();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const address = data?.address ?? "";
  let addressText = address;

  if (isPending) {
    addressText = copy.inbox.loading;
  } else if (isError) {
    addressText = copy.inbox.loadFailed;
  }

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <div>
      <PageHeader
        lead={dateLine()}
        showRunningSwitch={false}
        titleNode={
          <>
            {copy.inbox.addressTitlePlain}
            <span className="italic">{copy.inbox.addressTitleItalic}</span>
          </>
        }
      />
      <div className="mt-[22px] grid grid-cols-2 items-start gap-5 max-md:grid-cols-1">
        <section
          aria-labelledby="forwarding-what"
          className="flex flex-col gap-3.5 rounded-lg border border-border bg-card px-6 py-5.5 shadow-sh max-md:px-4"
        >
          <p className="text-[11px] leading-[13px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
            {copy.inbox.addressEyebrow}
          </p>
          <h2 className="font-serif text-[30px] leading-[1.1]" id="forwarding-what">
            {copy.inbox.addressWhatHeading}{" "}
            <span className="italic">{copy.inbox.addressWhatItalic}</span>
          </h2>
          <p className="text-[14.5px] text-muted-foreground">{copy.inbox.addressBody}</p>
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-md border border-input bg-background px-3.5 py-3">
            <span className="break-words font-mono text-sm leading-[1.5]">{addressText}</span>
            {isError ? (
              <button
                className="inline-flex min-h-9 items-center justify-center rounded-md border border-input bg-card px-3 text-[12.5px] font-semibold hover:bg-muted"
                onClick={() => {
                  void refetch();
                }}
                type="button"
              >
                {copy.inbox.retry}
              </button>
            ) : null}
            <button
              className="group inline-flex min-h-9 items-center justify-center max-md:min-h-11 max-md:-my-[4px] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={address === ""}
              onClick={() => {
                void copyAddress();
              }}
              type="button"
            >
              <span className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-input bg-card px-3 text-[12.5px] font-semibold group-hover:bg-muted">
                <NavGlyph name="copy" size={14} />
                {copied ? copy.inbox.addressCopied : copy.inbox.addressCopy}
              </span>
            </button>
          </div>
          {copyFailed ? (
            <output className="block text-[13px] text-need">{copy.inbox.addressCopyFailed}</output>
          ) : null}
          <p className="text-sm leading-[1.5]">
            <strong className="font-bold">{copy.inbox.addressNeverType}</strong>{" "}
            {copy.inbox.addressNeverTypeDetail}
          </p>
          <p className="text-[13px] text-muted-foreground">{copy.inbox.accountNote}</p>
        </section>
        <section
          aria-labelledby="forwarding-filter"
          className="flex flex-col gap-[18px] rounded-lg border border-border bg-card px-6 py-5.5 shadow-sh max-md:px-4"
        >
          <h2 className="font-serif text-[30px] leading-[1.1]" id="forwarding-filter">
            {copy.inbox.addressFilterHeading}{" "}
            <span className="italic">{copy.inbox.addressFilterItalic}</span>
          </h2>
          <div>
            <p className="mb-2.5 text-[11px] leading-[13px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
              {copy.inbox.gmailHeading}
            </p>
            <InboxSteps steps={copy.inbox.gmailSteps} />
          </div>
          <div className="border-t border-border pt-4">
            <p className="mb-2.5 text-[11px] leading-[13px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
              {copy.inbox.outlookHeading}
            </p>
            <InboxSteps steps={copy.inbox.outlookSteps} />
          </div>
          <div className="border-t border-border pt-4">
            <p className="text-sm leading-[1.5]">{copy.inbox.addressFilterSkip}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
