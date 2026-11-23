import { useEffect, useState } from "react";

import { copy } from "../../../shared/copy.ts";
import type { AdminRefusalCode, InvitesResponse } from "../../lib/admin-api.ts";
import { createInvite, loadInvites, revokeInvite } from "../../lib/admin-api.ts";
import { AdminStatusCard } from "./admin-status-card.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { InviteSection } from "./invite-section.tsx";
import { AdminPageHeading } from "./page-heading.tsx";

export function InvitesPage() {
  const [data, setData] = useState<InvitesResponse | null>(null);
  const [refusal, setRefusal] = useState<AdminRefusalCode | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = async () => {
    setLoadFailed(false);

    try {
      const result = await loadInvites();

      if (result.ok) {
        setData(result.data);
        setRefusal(null);
      } else {
        setRefusal(result.refusal);
      }
    } catch {
      setLoadFailed(true);
    }
  };

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoadFailed(false);

      try {
        const result = await loadInvites();

        if (!alive) {
          return;
        }

        if (result.ok) {
          setData(result.data);
          setRefusal(null);
        } else {
          setRefusal(result.refusal);
        }
      } catch {
        if (alive) {
          setLoadFailed(true);
        }
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, []);

  if (refusal !== null) {
    return (
      <AdminGateScreen
        code={refusal}
        onPasskeyDone={() => {
          void refresh();
        }}
      />
    );
  }

  if (loadFailed || data === null) {
    return (
      <>
        <AdminPageHeading italic="" lead="" plain={copy.admin.invitesTitlePlain} />
        <AdminStatusCard
          failed={loadFailed}
          onRetry={() => {
            void refresh();
          }}
        />
      </>
    );
  }

  const pending = data.invites.filter((row) => row.status === "pending");
  const accepted = data.invites.filter((row) => row.status === "accepted");
  const revoked = data.invites.filter((row) => row.status === "revoked");
  const empty = data.invites.length === 0;

  const submit = async () => {
    setBusy(true);
    setFailed(false);

    try {
      await createInvite(email);
      setEmail("");
      await refresh();
    } catch {
      setFailed(true);
    }

    setBusy(false);
  };

  const revoke = async (id: string) => {
    setBusyId(id);
    setFailed(false);

    try {
      await revokeInvite(id);
      await refresh();
    } catch {
      setFailed(true);
    }

    setBusyId(null);
  };

  return (
    <>
      <AdminPageHeading
        italic=""
        lead={copy.admin.invitesLead(data.grant.quantity, data.grant.days)}
        plain={copy.admin.invitesTitlePlain}
      />
      <section
        aria-labelledby="admin-invite-form"
        className="mt-6 rounded-lg border border-border bg-card p-[22px_24px] shadow-sh"
      >
        <h2 className="font-serif text-card-title leading-[1.1]" id="admin-invite-form">
          {copy.admin.inviteFormHeading}
        </h2>
        <p className="mt-1.5 max-w-[640px] text-xs leading-relaxed text-muted-foreground">
          {copy.admin.inviteFormIntro}
        </p>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="min-w-[240px] flex-[0_1_420px]">
            <span className="mb-1 block text-eyebrow font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {copy.admin.inviteEmailLabel}
            </span>
            <input
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              placeholder={copy.admin.inviteEmailPlaceholder}
              type="email"
              value={email}
            />
          </label>
          <button
            className="inline-flex h-10 items-center justify-center rounded-md border border-foreground bg-foreground px-4 text-sm font-semibold text-card hover:opacity-90 disabled:opacity-60"
            disabled={busy || !email.includes("@")}
            type="submit"
          >
            {copy.admin.inviteCreate}
          </button>
        </form>
        {failed ? (
          <p className="mt-3 text-xs font-semibold text-need" role="alert">
            {copy.admin.inviteCreateFailed}
          </p>
        ) : null}
      </section>
      {empty ? (
        <p className="mt-6 text-xs text-muted-foreground">{copy.admin.invitesEmpty}</p>
      ) : null}
      {pending.length === 0 ? null : (
        <InviteSection
          busyId={busyId}
          mode="pending"
          onRevoke={(id) => {
            void revoke(id);
          }}
          rows={pending}
        />
      )}
      {accepted.length === 0 ? null : (
        <InviteSection busyId={busyId} mode="accepted" onRevoke={() => undefined} rows={accepted} />
      )}
      {revoked.length === 0 ? null : (
        <InviteSection busyId={busyId} mode="revoked" onRevoke={() => undefined} rows={revoked} />
      )}
    </>
  );
}
