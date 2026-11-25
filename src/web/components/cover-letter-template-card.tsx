import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { fetchProfileFacts, saveProfileFacts } from "../lib/profile-api.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";
import { Textarea } from "./ui/textarea.tsx";

const COVER_LETTER_FACT_KEY = "cover_letter_template";
const cl = copy.nav.profilePages.coverLetter;

const DEFAULT_COVER_LETTER = [
  `${cl.salutationPrefix}${cl.tokens.hiringTeam}${cl.salutationMid}${cl.tokens.companyName}${cl.salutationEnd}`,
  `${cl.bodyOneStart}${cl.tokens.roleTitle}${cl.bodyOneMid}${cl.tokens.yearsExperience}${cl.bodyOneNext}${cl.tokens.coreStrength}${cl.bodyOneEnd}${cl.tokens.keyAchievement}${cl.bodyOneTail}`,
  `${cl.bodyTwoStart}${cl.tokens.companyName}${cl.bodyTwoMid}${cl.tokens.whyThisCompany}${cl.bodyTwoNext}${cl.tokens.relevantSkills}${cl.bodyTwoEnd}${cl.tokens.roleImpact}${cl.bodyTwoTail}`,
  `${cl.closing}\n${cl.tokens.yourName}`,
].join("\n\n");

const blankClass =
  "inline rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-signal-text";

function renderTemplateParagraph(paragraph: string, index: number) {
  const parts = paragraph.split(/(?<token>\{[a-z0-9_]+\})/giu);

  return (
    <p className="whitespace-pre-line" key={`cl-p-${String(index)}`}>
      {parts.map((part, partIndex) => {
        if (/^\{[a-z0-9_]+\}$/iu.test(part)) {
          return (
            <span className={blankClass} key={`tok-${String(index)}-${String(partIndex)}`}>
              {part}
            </span>
          );
        }

        return part;
      })}
    </p>
  );
}

export function CoverLetterTemplateCard() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [localSaved, setLocalSaved] = useState<string | null>(null);

  const factsQuery = useQuery({
    queryFn: fetchProfileFacts,
    queryKey: ["profile-facts"],
  });

  const savedFact =
    factsQuery.data?.facts.find((fact) => fact.key === COVER_LETTER_FACT_KEY)?.value ?? null;

  const currentText =
    localSaved ??
    (savedFact !== null && savedFact.trim() !== "" ? savedFact : DEFAULT_COVER_LETTER);

  const save = useMutation({
    mutationFn: async (nextValue: string) =>
      saveProfileFacts([{ key: COVER_LETTER_FACT_KEY, value: nextValue }]),
    onSuccess: (updated) => {
      queryClient.setQueryData(["profile-facts"], updated);
    },
  });

  const startEdit = () => {
    setDraft(currentText);
    setEditing(true);
  };

  const handleSave = () => {
    const trimmed = draft.trim();

    if (trimmed === "") {
      return;
    }

    const previousSaved = localSaved;

    setLocalSaved(trimmed);

    save.mutate(trimmed, {
      onError: () => {
        setLocalSaved(previousSaved);
        toast.error(cl.saveFailedToast);
      },
      onSuccess: () => {
        setLocalSaved(null);
        setEditing(false);
        toast.success(cl.savedToast);
      },
    });
  };

  const paragraphs = currentText.split(/\n{2,}/u).filter((part) => part.trim() !== "");

  return (
    <Card ariaLabelledBy="cover-letter-template" className="flex h-full min-h-0 flex-col p-5">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className={dsCardTitle} id="cover-letter-template">
              {cl.title}
            </h2>
            <Badge variant="signal">{cl.badge}</Badge>
          </div>
          <p className={`${dsBody} mt-1 max-w-2xl`}>{cl.lead}</p>
        </div>

        {editing ? null : (
          <Button onClick={startEdit} size="sm" variant="outline">
            <Pencil aria-hidden="true" size={14} />
            <span>{cl.edit}</span>
          </Button>
        )}
      </div>

      {editing ? (
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
          <Textarea
            ariaLabel={cl.title}
            className="min-h-56 flex-1 rounded-xl bg-background p-4 font-serif text-sm md:text-base"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            value={draft}
          />
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2.5">
            <Button
              onClick={() => {
                setDraft(DEFAULT_COVER_LETTER);
              }}
              size="sm"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" size={14} />
              <span>{cl.reset}</span>
            </Button>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  setEditing(false);
                }}
                size="sm"
                variant="outline"
              >
                {cl.cancel}
              </Button>
              <Button
                disabled={save.isPending || draft.trim() === ""}
                onClick={handleSave}
                size="sm"
                variant="primary"
              >
                <Check aria-hidden="true" size={14} />
                <span>{save.isPending ? cl.saving : cl.save}</span>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-4 font-serif text-sm leading-relaxed text-foreground md:p-5"
          data-scroll-region
        >
          {paragraphs.map((paragraph, index) => renderTemplateParagraph(paragraph, index))}
        </div>
      )}
    </Card>
  );
}
