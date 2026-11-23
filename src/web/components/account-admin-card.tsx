import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { adminPortalHref, isCrossOrigin, useMe } from "../lib/me-api.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

export function AccountAdminCard() {
  const me = useMe();
  const href = adminPortalHref(me);

  if (href === null) {
    return null;
  }

  const external = isCrossOrigin(href, globalThis.location.origin);

  return (
    <div id="admin-portal">
      <Card ariaLabelledBy="account-admin-heading" className="p-5 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className={dsCardTitle} id="account-admin-heading">
              {copy.admin.portalCardTitle}
            </h2>
            <p className={`${dsBody} mt-1`}>
              {external
                ? `${copy.admin.portalCardBody} ${copy.admin.portalExternalNote}`
                : copy.admin.portalCardBody}
            </p>
          </div>
          <Button asChild className="self-start sm:self-auto" size="sm" variant="secondary">
            {external ? (
              <a href={href} rel="noopener noreferrer" target="_blank">
                {copy.admin.portalOpen}
                <ArrowUpRight aria-hidden="true" size={15} />
              </a>
            ) : (
              <Link to="/admin">{copy.admin.portalOpen}</Link>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
