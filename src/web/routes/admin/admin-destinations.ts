import { copy } from "../../../shared/copy.ts";

export const adminDestinations = [
  { end: true, glyph: "home", label: copy.admin.navOverview, to: "/admin" },
  { end: false, glyph: "users", label: copy.admin.navUsers, to: "/admin/users" },
  { end: false, glyph: "mail", label: copy.admin.navInvites, to: "/admin/invites" },
  { end: false, glyph: "tag", label: copy.admin.navGrants, to: "/admin/grants" },
  { end: false, glyph: "link", label: copy.admin.navSwitches, to: "/admin/settings" },
  { end: false, glyph: "grid", label: copy.admin.navCatalog, to: "/admin/catalog" },
  { end: false, glyph: "send", label: copy.admin.navMailHealth, to: "/admin/mail-health" },
] as const;
