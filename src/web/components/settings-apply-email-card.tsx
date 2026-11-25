import { AtSign } from "lucide-react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { useApplyEmail, useSaveApplyEmail } from "../lib/inbox-api.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";
import { SectionSkeleton } from "./section-skeleton.tsx";
import { Switch } from "./ui/switch.tsx";

export function SettingsApplyEmailCard() {
  const applyEmail = useApplyEmail();
  const save = useSaveApplyEmail();
  const state = applyEmail.data;

  if (applyEmail.isPending) {
    return <SectionSkeleton />;
  }

  if (state === undefined) {
    return (
      <Card ariaLabelledBy="account-apply-email" className="p-5 md:p-6">
        <h2 className={dsCardTitle} id="account-apply-email">
          {copy.settings.applyEmailHeading}
        </h2>
        <p className="mt-1 text-xs font-semibold text-need" role="alert">
          {copy.settings.applyEmailLoadFailed}
        </p>
        <Button
          className="mt-4"
          onClick={() => {
            void applyEmail.refetch();
          }}
          size="sm"
          variant="outline"
        >
          {copy.settings.applyEmailRetry}
        </Button>
      </Card>
    );
  }

  const saved = state.usePersonalEmail;
  let detail = copy.settings.applyEmailUsingAlias(state.applyAddress ?? state.personalEmail);

  if (state.applyAddress === null) {
    detail = copy.settings.applyEmailToggleDetail(state.personalEmail);
  } else if (saved) {
    detail = copy.settings.applyEmailUsingPersonal(state.personalEmail);
  }

  const toggle = (usePersonalEmail: boolean) => {
    save.mutate(usePersonalEmail, {
      onError: () => {
        toast.error(copy.settings.applyEmailSaveError);
      },
      onSuccess: (next) => {
        toast.success(
          next.usePersonalEmail
            ? copy.settings.applyEmailSavedPersonal
            : copy.settings.applyEmailSavedAlias,
        );
      },
    });
  };

  return (
    <Card
      ariaLabelledBy="account-apply-email"
      className="p-5 md:p-6"
      dataTestId="settings-apply-email"
    >
      <div className="flex items-center gap-2">
        <AtSign aria-hidden="true" className="text-muted-foreground" size={18} />
        <h2 className={dsCardTitle} id="account-apply-email">
          {copy.settings.applyEmailHeading}
        </h2>
      </div>
      <p className={`${dsBody} mt-1 max-w-2xl`}>{copy.settings.applyEmailLead}</p>

      <div className="mt-5 rounded-lg border border-border bg-muted/40 px-4 py-3.5">
        <p className={dsEyebrow}>{copy.settings.applyEmailAliasLabel}</p>
        <p
          className={
            state.applyAddress === null
              ? "mt-1 break-words text-sm text-muted-foreground"
              : "mt-1 break-all font-mono text-sm font-medium text-foreground"
          }
        >
          {state.applyAddress ?? copy.settings.applyEmailNotAssigned}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{copy.settings.applyEmailAliasNote}</p>
      </div>

      <div className="mt-5 flex items-start justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{copy.settings.applyEmailToggle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        </div>
        <Switch
          ariaLabel={copy.settings.applyEmailToggle}
          checked={saved}
          disabled={save.isPending}
          onCheckedChange={toggle}
        />
      </div>
    </Card>
  );
}
