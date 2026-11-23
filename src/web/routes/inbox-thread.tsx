import { useParams } from "react-router";

import { InboxWorkspace } from "../components/inbox-workspace.tsx";

export function InboxThreadPage() {
  const { id = null } = useParams();

  return <InboxWorkspace routeThreadId={id} />;
}
