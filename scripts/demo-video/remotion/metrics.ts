import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";
import { z } from "zod";

export const coordPointSchema = z.tuple([z.number(), z.number()]);

export const rectBoxSchema = z.object({
  height: z.number(),
  width: z.number(),
  x: z.number(),
  y: z.number(),
});

export const sizeMetricsSchema = z.object({
  cardStart: coordPointSchema,
  dropTarget: coordPointSchema,
  inboxRow: coordPointSchema,
  overlaySize: coordPointSchema,
  scanBox: rectBoxSchema,
  uploadButton: coordPointSchema,
});

export const captureMetricsSchema = z.object({
  desktop: sizeMetricsSchema,
  mobile: sizeMetricsSchema,
});

export type CoordPoint = z.infer<typeof coordPointSchema>;

export type RectBox = z.infer<typeof rectBoxSchema>;

export type SizeMetrics = z.infer<typeof sizeMetricsSchema>;

export type CaptureMetrics = z.infer<typeof captureMetricsSchema>;

export const DEFAULT_CAPTURE_METRICS: CaptureMetrics = {
  desktop: {
    cardStart: [0.69, 0.25],
    dropTarget: [0.885, 0.69],
    inboxRow: [0.35, 0.48],
    overlaySize: [0.18, 0.16],
    scanBox: { height: 0.15, width: 0.28, x: 0.24, y: 0.35 },
    uploadButton: [0.29, 0.91],
  },
  mobile: {
    cardStart: [0.5, 0.42],
    dropTarget: [0.81, 0.245],
    inboxRow: [0.5, 0.46],
    overlaySize: [0.56, 0.05],
    scanBox: { height: 0.14, width: 0.72, x: 0.14, y: 0.34 },
    uploadButton: [0.5, 0.78],
  },
};

/**
 * Loads viewport-normalized UI coordinates captured alongside the demo screenshots.
 * @returns Desktop and mobile coordinate metrics once hydrated.
 */
export function useCaptureMetrics() {
  const [handle, setHandle] = useState(() => delayRender("Loading captured demo metrics"));
  const [metrics, setMetrics] = useState<CaptureMetrics>(DEFAULT_CAPTURE_METRICS);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch(staticFile("captures/metrics.json"));

        if (!response.ok) {
          cancelRender(
            new Error(`failed to load captures/metrics.json: ${String(response.status)}`),
          );

          return;
        }

        const raw: unknown = await response.json();
        const parsed = captureMetricsSchema.parse(raw);

        if (active) {
          setMetrics(parsed);
        }

        continueRender(handle);
      } catch (error) {
        cancelRender(error);
      }
    };

    void load();

    return () => {
      active = false;
      setHandle((current) => current);
    };
  }, [handle]);

  return metrics;
}
