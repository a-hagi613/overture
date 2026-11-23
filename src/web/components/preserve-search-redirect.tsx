import { Navigate, useLocation } from "react-router";

export function PreserveSearchRedirect({ to }: { to: string }) {
  const { hash, search } = useLocation();
  const hashIndex = to.indexOf("#");
  const pathPart = hashIndex === -1 ? to : to.slice(0, hashIndex);
  const hashPart = hashIndex === -1 ? hash : to.slice(hashIndex);

  return <Navigate replace to={`${pathPart}${search}${hashPart}`} />;
}
