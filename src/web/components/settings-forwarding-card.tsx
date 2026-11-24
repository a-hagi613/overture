import { Check, Copy, Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { useMailbox } from "../lib/inbox-api.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";
import { SegmentedControl } from "./ui/segmented-control.tsx";
import { SegmentedControlItem } from "./ui/segmented-control-item.tsx";

type ProviderTab = "gmail" | "outlook";

export function SettingsForwardingCard() {
  const { data, isError, isPending, refetch } = useMailbox();
  const [provider, setProvider] = useState<ProviderTab>("gmail");
  const [copied, setCopied] = useState(false);

  const address = data?.address ?? "";
  let addressText = address;

  if (isPending) {
    addressText = copy.inbox.loading;
  } else if (isError) {
    addressText = copy.inbox.loadFailed;
  }

  const steps = provider === "gmail" ? copy.inbox.gmailSteps : copy.inbox.outlookSteps;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
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
    <Card
      ariaLabelledBy="account-forwarding"
      className="p-5 md:p-6 lg:col-span-2"
      id="email-forwarding"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Mail aria-hidden="true" className="text-signal-text" size={18} />
            <h2 className={dsCardTitle} id="account-forwarding">
              {copy.inbox.forwardingSectionTitle}
            </h2>
            {data?.forwardingWorks === true ? (
              <Badge variant="ok">{copy.inbox.addressEyebrow}</Badge>
            ) : null}
          </div>
          <p className={`${dsBody} mt-1`}>{copy.inbox.forwardingSectionLead}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className={dsEyebrow}>{copy.inbox.addressEyebrow}</p>
          <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-background px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
              {addressText}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {isError ? (
                <Button
                  onClick={() => {
                    void refetch();
                  }}
                  size="sm"
                  variant="outline"
                >
                  {copy.inbox.retry}
                </Button>
              ) : null}
              <Button
                disabled={address === ""}
                onClick={() => {
                  void copyAddress();
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
          <p className="text-xs leading-relaxed text-foreground">
            <strong className="font-semibold">{copy.inbox.addressNeverType}</strong>{" "}
            <span className="text-muted-foreground">{copy.inbox.addressNeverTypeDetail}</span>
          </p>
          <p className="text-xs text-muted-foreground">{copy.inbox.accountNote}</p>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
          <div className="flex items-center justify-between gap-2">
            <p
              className={dsEyebrow}
            >{`${copy.inbox.addressFilterHeading} ${copy.inbox.addressFilterItalic}`}</p>
            <SegmentedControl
              ariaLabel="Email service"
              onValueChange={(value) => {
                if (value === "gmail" || value === "outlook") {
                  setProvider(value);
                }
              }}
              value={provider}
            >
              <SegmentedControlItem value="gmail">{copy.inbox.gmailHeading}</SegmentedControlItem>
              <SegmentedControlItem value="outlook">
                {copy.inbox.outlookHeading}
              </SegmentedControlItem>
            </SegmentedControl>
          </div>
          <ol className="list-decimal space-y-2 pl-4 text-xs leading-relaxed text-muted-foreground">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </div>
    </Card>
  );
}
