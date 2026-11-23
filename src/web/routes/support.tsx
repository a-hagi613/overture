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
  const [referenceId, setReferenceId] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();

    if (trimmedSubject.length < 3 || trimmedMessage.length < 10) {
      setError(sp.validationError);

      return;
    }

    setSending(true);
    setError(null);

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
    <div className="mx-auto max-w-3xl">
      <PageHeader
        lead={sp.lead}
        titleNode={
          <>
            {sp.titlePlain}
            <em className="italic text-signal">{sp.titleItalic}</em>
          </>
        }
      />

      <Card className="mt-6 p-5 md:p-6" variant="elevated">
        {referenceId === null ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-4 py-3">
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
                    key={item.id}
                    onClick={() => {
                      setCategory(item.id);
                    }}
                    size="sm"
                    variant={category === item.id ? "primary" : "secondary"}
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
                id="support-subject"
                onInput={(event) => {
                  setSubject(event.currentTarget.value);
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
              <textarea
                className="min-h-36 w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                id="support-message"
                onChange={(event) => {
                  setMessage(event.currentTarget.value);
                }}
                placeholder={sp.messagePlaceholder}
                value={message}
              />
            </div>

            {error === null ? null : (
              <p className="text-xs font-semibold text-need" role="alert">
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
