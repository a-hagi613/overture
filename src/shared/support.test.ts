import { expect, test } from "bun:test";

import { supportRequestSchema } from "./support.ts";

const valid = {
  category: "bug",
  message: "The Ready card never loads.",
  subject: "Ready card",
} as const;

test("a one-line support request is accepted", () => {
  expect(supportRequestSchema.parse(valid)).toEqual(valid);
});

test("a subject with a carriage return or line feed is refused", () => {
  for (const subject of ["Ready\r\nBcc: evil@example.test", "Ready\nBcc: evil@example.test"]) {
    expect(supportRequestSchema.safeParse({ ...valid, subject }).success).toBe(false);
  }
});

test("the subject is trimmed and padded out of the message", () => {
  const parsed = supportRequestSchema.parse({
    ...valid,
    message: "  The Ready card never loads.  ",
    subject: "  Ready card  ",
  });

  expect(parsed.subject).toBe("Ready card");
  expect(parsed.message).toBe("The Ready card never loads.");
});
