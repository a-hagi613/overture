import { describe, expect, test } from "bun:test";
import { z } from "zod";

import type { StapplyLeftover } from "./stapply-delta.ts";
import type { CatalogFetch } from "./stapply-refresh.ts";

import {
  STAPPLY_LLM_SYSTEM_PROMPT,
  createAnthropicStapplyClassifier,
  parseStapplyLlmAnswer,
} from "./stapply-tagging.ts";

const anthropicRequestSchema = z.object({
  system: z.string(),
  messages: z.array(z.object({ content: z.string() })),
});

const LEFTOVER: StapplyLeftover = {
  id: "posting-1",
  title: "Zookeeper",
  department: null,
  team: null,
  locationRaw: "Rostock",
  workplace: "onsite",
  employmentType: "full_time",
  experience: null,
  companyName: "Zoo GmbH",
};

describe("parseStapplyLlmAnswer", () => {
  test("accepts a bare array and an object with results", () => {
    expect(
      parseStapplyLlmAnswer('[{"index":0,"role":"Operations","subrole":null}]', 1),
    ).toEqual(new Map([[0, { role: "Operations", subrole: null }]]));
    expect(
      parseStapplyLlmAnswer(
        '{"results":[{"index":0,"role":"Sales","subrole":null}]}',
        1,
      ),
    ).toEqual(new Map([[0, { role: "Sales", subrole: null }]]));
  });

  test("tolerates a fenced code block", () => {
    expect(
      parseStapplyLlmAnswer(
        '```json\n[{"index":0,"role":"Legal","subrole":null}]\n```',
        1,
      ),
    ).toEqual(new Map([[0, { role: "Legal", subrole: null }]]));
  });

  test("drops an index outside the request and an invented role", () => {
    expect(
      parseStapplyLlmAnswer(
        '[{"index":5,"role":"Legal","subrole":null},{"index":0,"role":"Quantum Wizard","subrole":null}]',
        1,
      ),
    ).toEqual(new Map());
  });

  test("returns nothing for text that is not the contract", () => {
    expect(parseStapplyLlmAnswer("sure, here you go", 1)).toEqual(new Map());
    expect(parseStapplyLlmAnswer("null", 1)).toEqual(new Map());
  });
});

describe("createAnthropicStapplyClassifier", () => {
  test("sends one batched request and returns the accepted answers", async () => {
    const requests: { url: string; init: RequestInit }[] = [];

    const fetchImpl: CatalogFetch = async (url, init) => {
      requests.push({ url, init });
      await Promise.resolve();

      return Response.json({
        content: [{ type: "text", text: '[{"index":0,"role":"Operations","subrole":null}]' }],
      });
    };

    const classifier = createAnthropicStapplyClassifier({ apiKey: "test-key", fetchImpl });

    const result = await classifier([LEFTOVER]);

    expect(result).toEqual([{ id: "posting-1", role: "Operations", subrole: null }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.anthropic.com/v1/messages");

    const body = anthropicRequestSchema.parse(
      JSON.parse(z.string().parse(requests[0]?.init.body)),
    );

    const headers = new Headers(requests[0]?.init.headers);

    expect(headers.get("x-api-key")).toBe("test-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(body.system).toBe(STAPPLY_LLM_SYSTEM_PROMPT);
    expect(body.messages[0]?.content).toContain("Zookeeper");
    expect(body.messages[0]?.content).toContain("Zoo GmbH");
  });

  test("raises on a non-success response so the run can stop the pass", () => {
    const classifier = createAnthropicStapplyClassifier({
      apiKey: "test-key",
      fetchImpl: async () => {
        await Promise.resolve();

        return new Response("overloaded", { status: 529 });
      },
    });

    const call = classifier([LEFTOVER]);

    expect(call).rejects.toThrow(/HTTP 529/u);
  });

  test("returns no classifications when the model answers outside the taxonomy", async () => {
    const classifier = createAnthropicStapplyClassifier({
      apiKey: "test-key",
      fetchImpl: async () => {
        await Promise.resolve();

        return Response.json({ content: [{ type: "text", text: '[{"index":0,"role":"Wizard"}]' }] });
      },
    });

    expect(await classifier([LEFTOVER])).toEqual([]);
  });
});
