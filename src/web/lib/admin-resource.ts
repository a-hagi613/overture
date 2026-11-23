import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";

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

/**
 * The React Query key for one admin resource. An explicit query key carries the page's filters; a static page names
 * its resource instead, so every render and remount of that page reuses the same cache entry. Only a caller with
 * neither falls back to the loader's function identity.
 * @param load The loader the page calls.
 * @param queryKey The page's explicit key, including any filter or route parameter.
 * @param resourceId A stable id for a page that always loads the same resource.
 * @returns The React Query key for that resource.
 */
export function adminResourceQueryKey(
  load: AnyAdminLoader,
  queryKey?: readonly unknown[],
  resourceId?: string,
) {
  if (queryKey !== undefined) {
    return [ADMIN_QUERY_ROOT, ...queryKey];
  }

  return [ADMIN_QUERY_ROOT, "fn", resourceId ?? loaderKeyOf(load)];
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

export interface AdminResourceOptions {
  keepPreviousData?: boolean;
  /** A stable id for a page that always loads the same resource, so a remount reuses its cache. */
  resourceId?: string;
}

export function useAdminResource<T>(
  load: () => Promise<AdminResult<T>>,
  queryKey?: readonly unknown[],
  options?: AdminResourceOptions,
) {
  const queryClient = useQueryClient();

  const fullKey = adminResourceQueryKey(load, queryKey, options?.resourceId);

  const queryOptions: UseQueryOptions<AdminResult<T>> = {
    queryFn: load,
    queryKey: fullKey,
    retry: shouldRetryAdminQuery,
  };

  if (options?.keepPreviousData === true) {
    queryOptions.placeholderData = keepPreviousData;
  }

  const query = useQuery(queryOptions);

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
