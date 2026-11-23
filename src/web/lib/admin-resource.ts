import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { AdminRefusalCode, AdminResult } from "./admin-api.ts";

import { AdminHttpError } from "./admin-api.ts";

export const ADMIN_QUERY_ROOT = "admin-resource";

export interface AdminResource<T> {
  data: T | null;
  error: Error | null;
  failed: boolean;
  isFetching: boolean;
  isLoading: boolean;
  refusal: AdminRefusalCode | null;
  refresh: () => void;
}

type AnyAdminLoader = () => Promise<{ ok: boolean }>;

const loaderIds = new WeakMap<AnyAdminLoader, number>();
let nextLoaderId = 1;

function loaderKeyOf(load: AnyAdminLoader) {
  const existing = loaderIds.get(load);

  if (existing !== undefined) {
    return existing;
  }

  const assigned = nextLoaderId;

  nextLoaderId += 1;
  loaderIds.set(load, assigned);

  return assigned;
}

function shouldRetryAdminQuery(failureCount: number, error: Error) {
  if (failureCount >= 2) {
    return false;
  }

  if (error instanceof AdminHttpError) {
    return error.status >= 500;
  }

  return true;
}

export function useInvalidateAdminQueries() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: [ADMIN_QUERY_ROOT] });
  };
}

export function useAdminResource<T>(
  load: () => Promise<AdminResult<T>>,
  queryKey?: readonly unknown[],
) {
  const queryClient = useQueryClient();

  const fullKey: readonly unknown[] =
    queryKey === undefined
      ? [ADMIN_QUERY_ROOT, "fn", loaderKeyOf(load)]
      : [ADMIN_QUERY_ROOT, ...queryKey];

  const query = useQuery<AdminResult<T>>({
    queryFn: load,
    queryKey: fullKey,
    retry: shouldRetryAdminQuery,
  });

  const data = query.data?.ok === true ? query.data.data : null;
  const refusal = query.data?.ok === false ? query.data.refusal : null;

  const refresh = () => {
    if (refusal !== null) {
      void queryClient.invalidateQueries({ queryKey: [ADMIN_QUERY_ROOT] });

      return;
    }

    void queryClient.invalidateQueries({ queryKey: fullKey });
  };

  return {
    data,
    error: query.error,
    failed: query.isError,
    isFetching: query.isFetching,
    isLoading: query.isPending,
    refusal,
    refresh,
  } satisfies AdminResource<T>;
}
