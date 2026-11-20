import { z } from "zod";

import { RESUME_PDF_MODEL } from "../ports/resume-text.ts";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

const responseSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    }),
  ),
});

export function createAnthropicLlm(apiKey: string) {
  return {
    resumePdfFallback: async (pdf: Uint8Array<ArrayBuffer>) => {
      const response = await fetch(MESSAGES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: RESUME_PDF_MODEL,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: Buffer.from(pdf).toString("base64"),
                  },
                },
                {
                  type: "text",
                  text: "Extract the full text of this resume PDF in reading order. Return only the text.",
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Anthropic request failed with ${String(response.status)}`);
      }

      const parsed = responseSchema.parse(await response.json());

      const text = parsed.content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n")
        .trim();

      if (text.length === 0) {
        throw new Error("Anthropic returned no text for the resume PDF.");
      }

      return text;
    },
  };
}
