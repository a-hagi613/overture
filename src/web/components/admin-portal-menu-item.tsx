import { ExternalLink } from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { adminPortalHref, isCrossOrigin, useMe } from "../lib/me-api.ts";

export function AdminPortalMenuItem({
  className,
  onSelect,
  role,
}: {
  className: string;
  onSelect?: () => void;
  role?: "menuitem";
}) {
  const me = useMe();
  const href = adminPortalHref(me);

  if (href === null) {
    return null;
  }

  if (isCrossOrigin(href, globalThis.location.origin)) {
    return (
      <a
        className={className}
        href={href}
        onClick={onSelect}
        rel="noopener noreferrer"
        role={role}
        target="_blank"
      >
        {copy.admin.portalLink}
        <ExternalLink aria-hidden="true" className="ml-auto shrink-0" size={15} />
      </a>
    );
  }

  return (
    <Link className={className} onClick={onSelect} role={role} to="/admin">
      {copy.admin.portalLink}
    </Link>
  );
}
