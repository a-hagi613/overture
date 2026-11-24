import { Check, Copy, Share, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { useApplyEmail } from "../lib/inbox-api.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";

const DISMISSED_KEY = "overture.post-approval-card-dismissed";

const text = copy.onboarding.postApproval;

function isIosSafariNonStandalone() {
  const { maxTouchPoints, platform, userAgent } = navigator;

  const ios =
    /iPad|iPhone|iPod/u.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);

  const safari = /WebKit/u.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/u.test(userAgent);

  const installed =
    ("standalone" in navigator && navigator.standalone === true) ||
    globalThis.matchMedia("(display-mode: standalone)").matches;

  return ios && safari && !installed;
}

/**
 * The after-first-approval card: the auto-provisioned Overture address, and the
 * two-step Home Screen install for iOS Safari. It hides once dismissed.
 * @returns The card, or null once dismissed.
 */
export function PostApprovalCard() {
  const email = useApplyEmail();

  const [dismissed, setDismissed] = useState(
    () => globalThis.localStorage.getItem(DISMISSED_KEY) === "1",
  );

  const [copied, setCopied] = useState(false);

  if (dismissed) {
    return null;
  }

  const alias = email.data?.applyAddress ?? null;
  const showInstall = isIosSafariNonStandalone();

  const dismiss = () => {
    globalThis.localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  const copyAlias = async () => {
    if (alias === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(alias);
      setCopied(true);
      toast.success(text.copied);
      globalThis.setTimeout(() => {
        setCopied(false);
      }, 2500);
    } catch {
      toast.error(copy.inbox.addressCopyFailed);
    }
  };

  return (
    <Card className="mt-5 p-5 md:p-6" variant="elevated">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={dsCardTitle}>
            {`${text.titlePlain} `}
            <em className="italic text-signal-text">{text.titleItalic}</em>
          </h2>
          <p className={`${dsBody} mt-2 max-w-2xl`}>{text.intro}</p>
        </div>
        <Button
          ariaLabel={text.dismissAria}
          className="h-11 w-11 flex-none"
          onClick={dismiss}
          size="icon"
          variant="ghost"
        >
          <X aria-hidden="true" size={16} />
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <p className={dsEyebrow}>{text.aliasLabel}</p>
          <p className="mt-1 break-all font-mono text-sm font-medium text-foreground">
            {alias ?? text.aliasMissing}
          </p>
        </div>
        <Button
          disabled={alias === null}
          onClick={() => {
            void copyAlias();
          }}
          size="sm"
          variant="secondary"
        >
          {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
          <span>{copied ? text.copied : text.copy}</span>
        </Button>
      </div>

      {showInstall ? (
        <div className="mt-4 rounded-xl border border-border bg-muted p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Smartphone aria-hidden="true" size={16} />
            <span>{text.installTitle}</span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text.installBody}</p>
          <ol className="mt-3 flex flex-col gap-2">
            <li className="flex items-start gap-2 text-xs text-foreground">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-signal text-xs font-bold text-primary-ink">
                {String(1)}
              </span>
              <span className="flex items-start gap-1.5 pt-0.5">
                <Share aria-hidden="true" className="mt-0.5 shrink-0" size={12} />
                {text.installStepOne}
              </span>
            </li>
            <li className="flex items-start gap-2 text-xs text-foreground">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-signal text-xs font-bold text-primary-ink">
                {String(2)}
              </span>
              <span className="pt-0.5">{text.installStepTwo}</span>
            </li>
          </ol>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          className="inline-flex max-md:min-h-11 items-center text-sm font-semibold text-signal-text hover:underline"
          to="/inbox"
        >
          {text.inbox}
        </Link>
        <p className="text-xs text-muted-foreground">{text.personalNote}</p>
      </div>
    </Card>
  );
}
