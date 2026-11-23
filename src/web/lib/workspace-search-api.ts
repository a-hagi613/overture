import { useQuery } from "@tanstack/react-query";

import { workspaceSearchResponse } from "../../shared/workspace-search.ts";
import type { WorkspaceSearchResponse } from "../../shared/workspace-search.ts";

const EMPTY_RESULT: WorkspaceSearchResponse = {
  applications: [],
  emails: [],
  interviews: [],
  query: "",
  reviews: [],
};

async function fetchWorkspaceSearch(query: string) {
  const trimmed = query.trim();

  if (trimmed === "") {
    return EMPTY_RESULT;
  }

  const params = new URLSearchParams({ limit: "6", q: trimmed });
  const response = await fetch(`/api/workspace/search?${params.toString()}`);

  if (!response.ok) {
    return EMPTY_RESULT;
  }

  const parsed = workspaceSearchResponse.safeParse(await response.json());

  return parsed.success ? parsed.data : EMPTY_RESULT;
}

export function useWorkspaceSearch(query: string, enabled: boolean) {
  const trimmed = query.trim();

  return useQuery({
    enabled: enabled && trimmed.length > 0,
    queryFn: async () => fetchWorkspaceSearch(trimmed),
    queryKey: ["workspace-search", trimmed],
    staleTime: 15_000,
  });
}
