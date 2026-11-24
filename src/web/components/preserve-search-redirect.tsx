import { Navigate, useLocation } from "react-router";

import { redirectTarget } from "../lib/redirect-target.ts";

export function PreserveSearchRedirect({ to }: { to: string }) {
  const { hash, search } = useLocation();

  return <Navigate replace to={redirectTarget(to, { hash, search })} />;
}
