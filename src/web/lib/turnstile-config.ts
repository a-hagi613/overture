import { useEffect, useState } from "react";
import { z } from "zod";

const meSchema = z.object({
  turnstileScriptUrl: z.string().min(1).optional(),
  turnstileSiteKey: z.string().min(1).optional(),
});

export interface TurnstileConfig {
  scriptUrl: string | undefined;
  siteKey: string | null;
}

export function useTurnstileConfig() {
  const [config, setConfig] = useState<TurnstileConfig | undefined>(undefined);

  useEffect(() => {
    const load = async () => {
      let next: TurnstileConfig = { scriptUrl: undefined, siteKey: null };

      try {
        const response = await fetch("/api/me", { signal: AbortSignal.timeout(10_000) });

        if (response.ok) {
          const parsed = meSchema.parse(await response.json());

          next = {
            scriptUrl: parsed.turnstileScriptUrl,
            siteKey: parsed.turnstileSiteKey ?? null,
          };
        }
      } catch {
        next = { scriptUrl: undefined, siteKey: null };
      }

      setConfig(next);
    };

    void load();
  }, []);

  return config;
}
