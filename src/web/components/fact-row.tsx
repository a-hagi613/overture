import { Check, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

export function FactRow(props: {
  action: "edit" | "read-only";
  chip: ReactNode;
  kind?: "mono" | "serif";
  label: string;
  note: string;
  onSave?: (nextValue: string) => void;
  saving?: boolean;
  value: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.value);

  const startEdit = () => {
    setDraft(props.value);
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();

    if (trimmed === "") {
      return;
    }

    props.onSave?.(trimmed);
    setEditing(false);
  };

  let actionControl = null;

  if (!editing) {
    actionControl =
      props.action === "edit" ? (
        <Button
          ariaLabel={copy.profile.facts.aria(props.label, copy.profile.facts.edit)}
          onClick={startEdit}
          size="sm"
          variant="ghost"
        >
          <Pencil aria-hidden="true" size={14} />
          <span>{copy.profile.facts.edit}</span>
        </Button>
      ) : (
        <span className="text-xs font-medium text-muted-foreground">
          {copy.profile.facts.readOnly}
        </span>
      );
  }

  return (
    <div className="border-t border-border py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {props.label}
          </p>
          {editing ? (
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                commit();
              }}
            >
              <Input
                ariaLabel={props.label}
                className="h-9 max-w-md text-sm"
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
                value={draft}
              />
              <Button disabled={props.saving === true} size="sm" submit variant="primary">
                <Check aria-hidden="true" size={14} />
                <span>{copy.ready.save}</span>
              </Button>
              <Button
                onClick={() => {
                  setEditing(false);
                }}
                size="sm"
                variant="outline"
              >
                {copy.ready.cancel}
              </Button>
            </form>
          ) : (
            <p
              className={
                props.kind === "mono"
                  ? "mt-1 break-words font-mono text-sm text-foreground"
                  : "mt-1 text-base font-medium text-foreground"
              }
            >
              {props.value}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            {props.chip}
            {props.note === "" ? null : (
              <span className="text-xs text-muted-foreground tabular-nums">{props.note}</span>
            )}
          </div>
        </div>

        {actionControl}
      </div>
    </div>
  );
}
