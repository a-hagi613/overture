import { ArrowUpRight, Check, Copy } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { useMailbox } from "../lib/inbox-api.ts";
import { SourceChip } from "./source-chip.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";

export function AddressSection() {
  const { address } = copy.profile;
  const { data } = useMailbox();
  const [copied, setCopied] = useState(false);
  const liveAlias = data?.address ?? address.alias;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(liveAlias);
      setCopied(true);
      toast.success(copy.inbox.addressCopied);
      globalThis.setTimeout(() => {
        setCopied(false);
      }, 2500);
    } catch {
      toast.error(copy.inbox.addressCopyFailed);
    }
  };

  return (
    <Card ariaLabelledBy="profile-address-heading" className="mt-6 p-5 md:p-6" id="profile-address">
      <h2 className={dsCardTitle} id="profile-address-heading">
        {`${address.titlePlain} ${address.titleItalic}`}
      </h2>
      <p className={`${dsBody} mt-1 max-w-2xl`}>{address.intro}</p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3.5">
        <p className="min-w-0 flex-1 break-all font-mono text-sm font-medium text-foreground">
          {liveAlias}
        </p>
        <div className="flex items-center gap-2">
          <SourceChip variant="dashed">{address.chip}</SourceChip>
          <Button
            onClick={() => {
              void handleCopy();
            }}
            size="sm"
            variant="secondary"
          >
            {copied ? (
              <Check aria-hidden="true" size={14} />
            ) : (
              <Copy aria-hidden="true" size={14} />
            )}
            <span>{copied ? copy.inbox.addressCopied : copy.inbox.addressCopy}</span>
          </Button>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <dt className={dsEyebrow}>{address.onEveryForm}</dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">{address.onEveryFormValue}</dd>
        </div>
        <div>
          <dt className={dsEyebrow}>{address.repliesTo}</dt>
          <dd className="mt-1 text-sm font-semibold">
            <Link
              className="inline-flex items-center gap-1 text-signal-text hover:underline"
              to="/inbox"
            >
              <span>{address.repliesToValue}</span>
              <ArrowUpRight aria-hidden="true" size={14} />
            </Link>
          </dd>
        </div>
      </dl>

      <p className="mt-3 max-w-2xl text-xs text-muted-foreground">{address.changeNote}</p>
    </Card>
  );
}
