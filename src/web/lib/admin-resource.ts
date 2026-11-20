import { useEffect, useState } from "react";

import type { AdminRefusalCode, AdminResult } from "./admin-api.ts";

export interface AdminResource<T> {
  data: T | null;
  refusal: AdminRefusalCode | null;
  refresh: () => void;
}

async function runAdminLoad<T>(
  load: () => Promise<AdminResult<T>>,
  apply: (loaded: T) => void,
  refuse: (code: AdminRefusalCode) => void,
) {
  const result = await load();

  if (result.ok) {
    apply(result.data);
  } else {
    refuse(result.refusal);
  }
}

export function useAdminResource<T>(load: () => Promise<AdminResult<T>>) {
  const [data, setData] = useState<T | null>(null);
  const [refusal, setRefusal] = useState<AdminRefusalCode | null>(null);

  const refresh = () => {
    void runAdminLoad(
      load,
      (loaded) => {
        setData(loaded);
        setRefusal(null);
      },
      setRefusal,
    );
  };

  useEffect(() => {
    let alive = true;

    void runAdminLoad(
      load,
      (loaded) => {
        if (alive) {
          setData(loaded);
          setRefusal(null);
        }
      },
      (code) => {
        if (alive) {
          setRefusal(code);
        }
      },
    );

    return () => {
      alive = false;
    };
  }, [load]);

  return { data, refusal, refresh };
}
