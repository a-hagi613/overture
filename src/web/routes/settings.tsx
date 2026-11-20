import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import { AccountRow } from "../components/account-row.tsx";
import { FilterChip } from "../components/filter-chip.tsx";
import { LimitRow } from "../components/limit-row.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { authClient } from "../lib/auth-client.ts";
import { fetchLanguages, saveLanguages } from "../lib/profile-api.ts";

export function SettingsPage() {
  const { data: session } = authClient.useSession();
  const email = session === null ? "" : session.user.email;
  const [signedOutOthers, setSignedOutOthers] = useState(false);
  const queryClient = useQueryClient();

  const languagesQuery = useQuery({ queryKey: ["profile-languages"], queryFn: fetchLanguages });

  const languagesSave = useMutation({
    mutationFn: saveLanguages,
    onSuccess: (saved) => {
      queryClient.setQueryData(["profile-languages"], saved);
    },
  });

  const selectedLanguages = languagesQuery.data?.languages ?? [];

  const languageChips = [
    { code: "en", label: copy.settings.languageEnglish },
    { code: "fr", label: copy.settings.languageFrench },
    { code: "de", label: copy.settings.languageGerman },
  ] as const;

  function toggleLanguage(code: string) {
    const next = selectedLanguages.includes(code)
      ? selectedLanguages.filter((candidate) => candidate !== code)
      : [...selectedLanguages, code];

    languagesSave.mutate(next);
  }

  const revokeOthers = async () => {
    const result = await authClient.revokeOtherSessions();

    if (result.error === null) {
      setSignedOutOthers(true);
    }
  };

  return (
    <div className="mx-auto max-w-[880px]">
      <PageHeader
        lead={copy.settings.lead}
        titleNode={
          <>
            {copy.settings.titlePlain} <span className="italic">{copy.settings.titleItalic}</span>
          </>
        }
      />
      <div className="mt-7 flex flex-col gap-5">
        <section
          aria-labelledby="settings-account"
          className="rounded-lg border border-border bg-card p-[22px_24px_10px] shadow-sh"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="settings-account" className="font-serif text-[26px] leading-[1.1]">
              {copy.settings.accountHeading}
            </h2>
            <span className="font-serif text-sm italic text-muted-foreground">
              {copy.settings.folio1}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{email}</p>
          <div className="mt-2.5">
            <AccountRow label={copy.signIn.google} detail={copy.settings.providerNote} />
            <AccountRow label={copy.signIn.linkedin} detail={copy.settings.providerNote} />
            <AccountRow
              label={copy.settings.magicLinkTitle}
              detail={copy.settings.magicLinkDetail}
            />
            <AccountRow
              label={copy.settings.jobSearchAddress}
              detail={copy.settings.addressDetail}
            />
            <div className="flex items-center justify-between gap-4 border-t border-border py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{copy.settings.signOutAll}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  {signedOutOthers
                    ? copy.settings.signedOutMessage
                    : copy.settings.signOutAllDetail}
                </p>
              </div>
              <button
                className="inline-flex h-11 flex-none items-center justify-center rounded-md border border-input bg-card px-[18px] text-[13.5px] font-semibold hover:bg-muted"
                onClick={() => {
                  void revokeOthers();
                }}
                type="button"
              >
                {copy.settings.signOutAllButton}
              </button>
            </div>
          </div>
        </section>
        <section
          aria-labelledby="settings-limits"
          className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="settings-limits" className="font-serif text-[26px] leading-[1.1]">
              {copy.settings.limitsHeadingPlain}{" "}
              <span className="italic">{copy.settings.limitsHeadingItalic}</span>
            </h2>
            <span className="font-serif text-sm italic text-muted-foreground">
              {copy.settings.folio2}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.settings.limitsIntro}</p>
          <div className="mt-4">
            <LimitRow detail={copy.settings.limitDailyDetail} label={copy.settings.limitDaily} />
            <LimitRow detail={copy.settings.limitWindowDetail} label={copy.settings.limitWindow} />
            <LimitRow
              detail={copy.settings.limitCompanyDetail}
              label={copy.settings.limitCompany}
            />
            <LimitRow detail={copy.settings.limitRepostDetail} label={copy.settings.limitRepost} />
          </div>
          <p className="mt-2 border-t border-border pt-3.5 text-[12.5px] text-muted-foreground">
            {copy.settings.limitsFixed}
          </p>
        </section>
        <section
          aria-labelledby="settings-languages"
          className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="settings-languages" className="font-serif text-[26px] leading-[1.1]">
              {copy.settings.languagesHeading}
            </h2>
            <span className="font-serif text-sm italic text-muted-foreground">
              {copy.settings.languagesFolio}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.settings.languagesHint}</p>
          <fieldset
            aria-label={copy.settings.languagesGroup}
            className="m-0 mt-4 flex min-w-0 flex-wrap gap-2 border-0 p-0"
          >
            {languageChips.map((chip) => (
              <FilterChip
                key={chip.code}
                on={selectedLanguages.includes(chip.code)}
                onClick={() => toggleLanguage(chip.code)}
              >
                {chip.label}
              </FilterChip>
            ))}
          </fieldset>
        </section>
      </div>
    </div>
  );
}
