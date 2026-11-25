import { copy } from "../../shared/copy.ts";
import type { ReadyAnswer } from "../lib/ready-api.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Textarea } from "./ui/textarea.tsx";

/**
 * Inline answer edit form used inside Ready application answer rows and grid cells.
 * @param props Form state and callbacks.
 * @param props.answer Question metadata being edited.
 * @param props.draft Current controlled draft text.
 * @param props.onCancel Invoked when editing is cancelled.
 * @param props.onChange Invoked as the user types a replacement answer.
 * @param props.onSubmit Invoked on form submission with the trimmed/raw draft value.
 * @param props.saving Whether a save mutation is currently in flight.
 * @returns Inline form with input/textarea and Save/Cancel actions.
 */
export function ReadyAnswerEditor({
  answer,
  draft,
  onCancel,
  onChange,
  onSubmit,
  saving,
}: {
  answer: ReadyAnswer;
  draft: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  saving: boolean;
}) {
  const freeText = answer.kind === "open_text";

  return (
    <form
      className="mt-2.5 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {freeText ? (
        <Textarea
          ariaLabel={copy.ready.editLabel(answer.label)}
          className="min-h-20 bg-background px-3 py-2"
          onChange={(event) => {
            onChange(event.target.value);
          }}
          value={draft}
        />
      ) : (
        <Input
          ariaLabel={copy.ready.editLabel(answer.label)}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          value={draft}
        />
      )}
      <div className="flex items-center gap-2">
        <Button disabled={saving} size="sm" submit variant="primary">
          {saving ? copy.ready.saving : copy.ready.save}
        </Button>
        <Button onClick={onCancel} size="sm" variant="outline">
          {copy.ready.cancel}
        </Button>
      </div>
    </form>
  );
}
