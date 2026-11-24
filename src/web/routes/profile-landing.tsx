import { Navigate } from "react-router";

import { ProfileHub } from "../components/profile-hub.tsx";
import { useMediaQuery } from "../lib/media-query.ts";

/**
 * `/profile` is the phone profile hub; on the desktop layout it keeps the old
 * redirect to the first profile page.
 *
 * @returns The phone profile hub, or a redirect to `/profile/resume` on desktop.
 */
export function ProfileLandingPage() {
  const desktop = useMediaQuery("(min-width: 768px)");

  if (desktop) {
    return <Navigate replace to="/profile/resume" />;
  }

  return <ProfileHub />;
}
