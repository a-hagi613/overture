import { useState } from "react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { supportResponseSchema } from "../../shared/support.ts";
import type { SupportCategory } from "../../shared/support.ts";
import { PageHeader } from "../components/page-header.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle, dsMono } from "../components/ui/ds.ts";
import { Input } from "../components/ui/input.tsx";
import { Separator } from "../components/ui/separator.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { authClient } from "../lib/auth-client.ts";

const CATEGORIES: readonly { id: SupportCategory; label: string }[] = [
  { id: "account", label: copy.nav.supportPage.categories.account },
  { id: "billing", label: copy.nav.supportPage.categories.billing },
  { id: "bug", label: copy.nav.supportPage.categories.bug },
  { id: "other", label: copy.nav.supportPage.categories.other },
];

export function SupportPage() {
  const { data: session } = authClient.useSession();
  const userName = session?.user.name ?? "";
  const userEmail = session?.user.email ?? "";
  const sp = copy.nav.supportPage;

  const [category, setCategory] = useState<SupportCategory>("account");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<{ message: boolean; subject: boolean } | null>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();
    const subjectInvalid = trimmedSubject.length < 3;
    const messageInvalid = trimmedMessage.length < 10;

    if (subjectInvalid || messageInvalid) {
      setInvalid({ message: messageInvalid, subject: subjectInvalid });
      setError(sp.validationError);
      globalThis.document
        .getElementById(subjectInvalid ? "support-subject" : "support-message")
        ?.focus();

      return;
    }

    setSending(true);
    setError(null);
    setInvalid(null);

    try {
      const response = await fetch("/api/support", {
        body: JSON.stringify({
          category,
          message: trimmedMessage,
          subject: trimmedSubject,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      if (response.status === 429) {
        setError(sp.rateLimitError);
        setSending(false);

        return;
      }

      if (!response.ok) {
        setError(sp.genericError);
        setSending(false);

        return;
      }

      const parsed = supportResponseSchema.parse(await response.json());

      setReferenceId(parsed.referenceId);
      setSubject("");
      setMessage("");
      toast.success(sp.sentTitle);
    } catch {
      setError(sp.genericError);
    }

    setSending(false);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader titleNode={sp.titlePlain} />

      <Card className="mt-6 max-w-4xl p-5 md:p-6" variant="default">
        {referenceId === null ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <span className="text-xs font-semibold text-muted-foreground">{sp.fromLabel}</span>
              <span className={`${dsMono} min-w-0 break-all`}>
                {userName === "" ? userEmail : `${userName} · ${userEmail}`}
              </span>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold text-foreground">{sp.categoryLabel}</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((item) => (
                  <Button
                    ariaPressed={category === item.id}
                    className="rounded-full"
                    key={item.id}
                    onClick={() => {
                      setCategory(item.id);
                    }}
                    size="sm"
                    variant={category === item.id ? "primary" : "outline"}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            <div>
              <label
                className="mb-1.5 block text-xs font-semibold text-foreground"
                htmlFor="support-subject"
              >
                {sp.subjectLabel}
              </label>
              <Input
                ariaDescribedBy={invalid?.subject === true ? "support-error" : undefined}
                id="support-subject"
                invalid={invalid?.subject === true}
                onInput={(event) => {
                  setSubject(event.currentTarget.value);
                  setInvalid(null);
                  setError(null);
                }}
                placeholder={sp.subjectPlaceholder}
                type="text"
                value={subject}
              />
            </div>

            <div>
              <label
                className="mb-1.5 block text-xs font-semibold text-foreground"
                htmlFor="support-message"
              >
                {sp.messageLabel}
              </label>
              <Textarea
                ariaDescribedBy={invalid?.message === true ? "support-error" : undefined}
                className="min-h-36"
                id="support-message"
                invalid={invalid?.message === true}
                onChange={(event) => {
                  setMessage(event.currentTarget.value);
                  setInvalid(null);
                  setError(null);
                }}
                placeholder={sp.messagePlaceholder}
                value={message}
              />
            </div>

            {error === null ? null : (
              <p className="text-xs font-semibold text-need" id="support-error" role="alert">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <Button ariaBusy={sending} disabled={sending} size="default" submit variant="primary">
                {sending ? sp.sending : sp.submit}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col items-start gap-3 py-4">
            <Badge variant="ok">{sp.sentTitle}</Badge>
            <h2 className={dsCardTitle}>{sp.sentTitle}</h2>
            <p className={dsBody}>{sp.sentBody(userEmail, referenceId)}</p>
            <Button
              className="mt-2"
              onClick={() => {
                setReferenceId(null);
              }}
              size="default"
              variant="secondary"
            >
              {sp.sendAnother}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
