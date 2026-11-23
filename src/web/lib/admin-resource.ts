import { useEffect, useState } from "react";

import type { AdminRefusalCode, AdminResult } from "./admin-api.ts";

export interface AdminResource<T> {
  data: T | null;
  failed: boolean;
  refusal: AdminRefusalCode | null;
  refresh: () => void;
}

async function runAdminLoad<T>(
  load: () => Promise<AdminResult<T>>,
  apply: (loaded: T) => void,
  refuse: (code: AdminRefusalCode) => void,
  fail: () => void,
) {
  let result: AdminResult<T>;

  try {
    result = await load();
  } catch {
    fail();

    return;
  }

  if (result.ok) {
    apply(result.data);
  } else {
    refuse(result.refusal);
  }
}

export function useAdminResource<T>(load: () => Promise<AdminResult<T>>) {
  const [data, setData] = useState<T | null>(null);
  const [refusal, setRefusal] = useState<AdminRefusalCode | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = () => {
    void runAdminLoad(
      load,
      (loaded) => {
        setData(loaded);
        setRefusal(null);
        setFailed(false);
      },
      setRefusal,
      () => {
        setFailed(true);
      },
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
          setFailed(false);
        }
      },
      (code) => {
        if (alive) {
          setRefusal(code);
        }
      },
      () => {
        if (alive) {
          setFailed(true);
        }
      },
    );

    return () => {
      alive = false;
    };
  }, [load]);

  return { data, failed, refusal, refresh };
}
