import { useEffect, useState } from "react";
import { z } from "zod";

const meSchema = z.object({
  turnstileSiteKey: z.string().optional(),
});

export function useTurnstileSiteKey() {
  const [siteKey, setSiteKey] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/me");

      if (response.ok) {
        const parsed = meSchema.parse(await response.json());

        setSiteKey(parsed.turnstileSiteKey ?? null);
      }
    };

    void load();
  }, []);

  return siteKey;
}
