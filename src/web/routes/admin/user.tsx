import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { NavGlyph } from "../../components/nav-glyph.tsx";
import { ThemeToggle } from "../../components/theme-toggle.tsx";
import type { AdminRefusalCode, AdminUserDetail } from "../../lib/admin-api.ts";
import { loadUser, reinstateUser, suspendUser } from "../../lib/admin-api.ts";
import { adminDay, adminDayTime } from "../../lib/admin-date.ts";
import { AdminAccountItem } from "./account-item.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminStatRow } from "./stat-row.tsx";
import { AdminStatusPill } from "./status-pill.tsx";

const DAY_MS = 24 * 60 * 60 * 1000;

const cardClass = "rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh";

function grantDaysOf(grant: NonNullable<AdminUserDetail["user"]["grant"]>) {
  if (grant.expiresAt === null) {
    return null;
  }

  return Math.max(1, Math.round((grant.expiresAt - grant.startsAt) / DAY_MS));
}

function displayNameOf(user: { email: string; name: string }) {
  return user.name.trim() === "" ? user.email : user.name;
}

export function UserPage() {
  const { id } = useParams();
  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [refusal, setRefusal] = useState<AdminRefusalCode | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const request = useMemo(() => ({ id: id ?? "" }), [id]);

  const refresh = async () => {
    const result = await loadUser(request.id);

    if (result.ok) {
      setData(result.data);
      setRefusal(null);
    } else {
      setRefusal(result.refusal);
    }
  };

  useEffect(() => {
    let alive = true;

    const load = async () => {
      const result = await loadUser(request.id);

      if (!alive) {
        return;
      }

      if (result.ok) {
        setData(result.data);
        setRefusal(null);
      } else {
        setRefusal(result.refusal);
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, [request]);

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

  if (data === null) {
    return null;
  }

  const { user } = data;
  const { now } = data;
  const displayName = displayNameOf(user);
  const suspended = user.status === "suspended";
  const { grant } = user;
  const days = grant === null ? null : grantDaysOf(grant);

  const usedPercent =
    grant === null || grant.quantity === 0
      ? 0
      : Math.min(100, Math.round((grant.used / grant.quantity) * 100));

  const targets =
    user.targets === null
      ? copy.admin.accountNoTargets
      : copy.admin.userTargetsText(user.targets.roles, user.targets.locations);

  const apply = async () => {
    setBusy(true);
    setFailed(false);

    try {
      if (suspended) {
        await reinstateUser(user.id, reason);
      } else {
        await suspendUser(user.id, reason);
      }

      setReason("");
      await refresh();
    } catch {
      setFailed(true);
    }

    setBusy(false);
  };

  return (
    <>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <nav className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Link className="hover:text-foreground" to="/admin/users">
              {copy.admin.userBreadcrumb}
            </Link>
            <span aria-hidden="true">{copy.admin.breadcrumbSlash}</span>
            <span>{displayName}</span>
          </nav>
          <p className="mt-1 font-serif text-[15px] italic text-muted-foreground">
            {copy.admin.userJoined(user.email, adminDay(user.createdAt))}
          </p>
          <h1 className="mt-0.5 font-serif text-[32px] leading-[1.05] md:text-[42px]">
            {displayName}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <AdminStatusPill status={user.status} />
            {user.acceptedAt === null ? null : (
              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground">
                {copy.admin.userAccepted(adminDay(user.acceptedAt))}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-card px-3.5 text-[13.5px] font-semibold text-muted-foreground"
            disabled
            type="button"
          >
            <NavGlyph name="lock" size={15} />
            {copy.admin.userReveal}
          </button>
          <ThemeToggle className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-input bg-card hover:bg-muted" />
        </div>
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="admin-user-account" className={cardClass}>
          <h2 className="font-serif text-[26px] leading-[1.1]" id="admin-user-account">
            {copy.admin.accountHeading}
          </h2>
          <dl className="mt-3">
            <AdminAccountItem label={copy.admin.accountEmail}>{user.email}</AdminAccountItem>
            <AdminAccountItem label={copy.admin.accountForwarding}>
              <span className="block font-semibold">
                {user.forwardingAddress ?? copy.admin.accountNoForwarding}
              </span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                {copy.admin.accountForwardingNote}
              </span>
            </AdminAccountItem>
            <AdminAccountItem label={copy.admin.accountResume}>
              <span className="block font-semibold">
                {user.resume?.filename ?? copy.admin.accountNoResume}
              </span>
              {user.resume === null ? null : (
                <span className="mt-0.5 block text-[12px] text-muted-foreground">
                  {copy.admin.accountResumeUploaded(adminDay(user.resume.uploadedAt))}
                </span>
              )}
            </AdminAccountItem>
            <AdminAccountItem label={copy.admin.accountTargets}>{targets}</AdminAccountItem>
            <AdminAccountItem label={copy.admin.accountLastActivity}>
              {user.lastActiveAt === null
                ? copy.admin.lastActivityNever
                : adminDayTime(user.lastActiveAt, now)}
            </AdminAccountItem>
          </dl>
        </section>
        <section aria-labelledby="admin-user-grants" className={cardClass}>
          <h2 className="font-serif text-[26px] leading-[1.1]" id="admin-user-grants">
            {copy.admin.userGrantsHeading}
          </h2>
          {grant === null ? (
            <p className="mt-3 text-[12.5px] text-muted-foreground">{copy.admin.grantNoGrant}</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold">{copy.admin.grantAdminTitle}</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="font-serif text-[30px] leading-none tabular-nums">
                    {grant.remaining}
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    {copy.admin.grantLeftOf(grant.quantity)}
                  </span>
                </span>
              </div>
              <div
                aria-hidden="true"
                className="mt-2 h-[7px] overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: `${usedPercent}%` }}
                />
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                {copy.admin.grantSummary(
                  grant.quantity,
                  days ?? 30,
                  adminDay(grant.startsAt),
                  grant.expiresAt === null ? copy.admin.inviteNone : adminDay(grant.expiresAt),
                  grant.used,
                )}
              </p>
            </>
          )}
          <div className="mt-4">
            <AdminStatRow label={copy.admin.statSent} value={user.stats.sentThisWeek} />
            <AdminStatRow label={copy.admin.statReady} value={user.stats.readyToSend} />
            <AdminStatRow label={copy.admin.statFailed} value={user.stats.couldNotApply} />
            <AdminStatRow label={copy.admin.statReviews} value={user.stats.reviewsOpen} />
          </div>
        </section>
        {user.role === "owner" ? null : (
          <section aria-labelledby="admin-user-suspend" className={`${cardClass} lg:col-span-2`}>
            <h2 className="font-serif text-[26px] leading-[1.1]" id="admin-user-suspend">
              {suspended ? copy.admin.reinstateHeading : copy.admin.suspendHeading}
            </h2>
            <p className="mt-1.5 max-w-[720px] text-[12.5px] leading-relaxed text-muted-foreground">
              {suspended ? copy.admin.reinstateIntro : copy.admin.suspendIntro}
            </p>
            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void apply();
              }}
            >
              <label className="block max-w-[620px]">
                <span className="mb-1 block text-[12px] font-semibold">
                  {copy.admin.suspendReason}
                </span>
                <textarea
                  className="min-h-[92px] w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                  placeholder={
                    suspended ? copy.admin.reinstatePlaceholder : copy.admin.suspendPlaceholder
                  }
                  value={reason}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2.5">
                <button
                  className="inline-flex h-10 items-center justify-center rounded-md border border-need px-4 text-[13.5px] font-semibold text-need hover:bg-need-soft disabled:opacity-60"
                  disabled={busy || reason.trim().length === 0}
                  type="submit"
                >
                  {suspended ? copy.admin.reinstateAction : copy.admin.suspendAction}
                </button>
                <button
                  className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-card px-4 text-[13.5px] font-semibold hover:bg-muted"
                  onClick={() => {
                    setReason("");
                    setFailed(false);
                  }}
                  type="button"
                >
                  {copy.admin.suspendCancel}
                </button>
              </div>
              {failed ? (
                <p className="mt-3 text-[12.5px] font-semibold text-need" role="alert">
                  {copy.admin.suspendFailed}
                </p>
              ) : null}
            </form>
          </section>
        )}
      </div>
    </>
  );
}
