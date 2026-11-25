import { useEffect, useState } from "react";
import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import type { AdminDashboards, AdminRefusalCode } from "../../lib/admin-api.ts";
import { loadDashboards } from "../../lib/admin-api.ts";
import { ExternalDashboardLink } from "./dashboard-link.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { AdminStatusCard } from "./admin-status-card.tsx";

const GROUPS = ["metrics", "edge", "spend"] as const;

const cardClass = "rounded-lg border border-border bg-card px-6 py-5 shadow-sh";

export function DashboardsPage() {
  const [data, setData] = useState<AdminDashboards | null>(null);
  const [refusal, setRefusal] = useState<AdminRefusalCode | null>(null);
  const [failed, setFailed] = useState(false);

  const apply = (result: Awaited<ReturnType<typeof loadDashboards>>) => {
    if (result.ok) {
      setData(result.data);
    } else {
      setRefusal(result.refusal);
    }
  };

  const refresh = async () => {
    setFailed(false);

    try {
      apply(await loadDashboards());
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const result = await loadDashboards();

        if (alive) {
          if (result.ok) {
            setData(result.data);
          } else {
            setRefusal(result.refusal);
          }
        }
      } catch {
        if (alive) {
          setFailed(true);
        }
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, []);

  if (refusal !== null) {
    return <AdminGateScreen code={refusal} />;
  }

  return (
    <>
      <AdminPageHeading
        italic=""
        lead={copy.admin.dashboardsLead}
        plain={copy.admin.dashboardsTitle}
      />
      <p className="mt-2 max-w-[720px] text-sm text-muted-foreground">
        {copy.admin.dashboardsIntro}
      </p>
      {data === null ? (
        <AdminStatusCard
          failed={failed}
          onRetry={() => {
            void refresh();
          }}
        />
      ) : (
        <>
          <p className="mt-3 text-xs font-semibold" data-testid="admin-dashboards-presence">
            {copy.admin.dashboardsPresence(data.onlineNow, data.signedInNow)}
          </p>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {GROUPS.map((group) => {
              const links = data.links.filter((link) => link.group === group);

              return links.length === 0 ? null : (
                <section
                  aria-labelledby={`admin-dashboards-${group}`}
                  className={cardClass}
                  key={group}
                >
                  <h2
                    className="font-serif text-card-title leading-[1.1]"
                    id={`admin-dashboards-${group}`}
                  >
                    {copy.admin.dashboardsGroup(group)}
                  </h2>
                  <div className="mt-3">
                    {links.map((link) => (
                      <ExternalDashboardLink href={link.href} id={link.id} key={link.id} />
                    ))}
                  </div>
                </section>
              );
            })}
            <section aria-labelledby="admin-dashboards-internal" className={cardClass}>
              <h2
                className="font-serif text-card-title leading-[1.1]"
                id="admin-dashboards-internal"
              >
                {copy.admin.dashboardsInternal}
              </h2>
              <div className="mt-3">
                {copy.admin.dashboardsInternalLinks.map((link) => (
                  <Link
                    className="block border-t border-border py-3 text-sm font-semibold first:border-t-0 hover:underline"
                    key={link.to}
                    to={link.to}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
