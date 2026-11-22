import { describe, expect, test } from "bun:test";

import { buildDossier, dossierSchema } from "./dossier.ts";
import type { DossierInput } from "./dossier.ts";

const resume = { bytes: 188_416, filename: "Maya_Okafor_Resume.pdf", sha256: "a".repeat(64) };

function input(overrides: Partial<DossierInput> = {}) {
  return {
    answers: [],
    coverLetter: null,
    confirmedBy: "page",
    provider: "greenhouse",
    resume,
    resumeLines: [
      { id: "L1", text: "Staff Backend Engineer · Redpine Commerce" },
      { id: "L2", text: "Led migration to Go services" },
    ],
    resumeSha256: resume.sha256,
    submittedAt: 1_700_000_000_000,
    ...overrides,
  } satisfies DossierInput;
}

describe("buildDossier sent via", () => {
  test("reports the provider, the confirmation source and the time", () => {
    expect(buildDossier(input({ confirmedBy: "email" })).sentVia).toEqual({
      confirmedBy: "email",
      provider: "greenhouse",
      submittedAt: 1_700_000_000_000,
    });
  });

  test("keeps the confirmation page source when the page confirmed", () => {
    expect(buildDossier(input()).sentVia.confirmedBy).toBe("page");
  });
});

describe("buildDossier file as sent", () => {
  test("matching hash means the stored file is the file that was sent", () => {
    const { file } = buildDossier(input());

    expect(file?.sentUnchanged).toBe(true);
    expect(file?.filename).toBe("Maya_Okafor_Resume.pdf");
    expect(file?.sha256).toBe(resume.sha256);
  });

  test("mismatched hash is reported as not sent unchanged", () => {
    expect(buildDossier(input({ resumeSha256: "b".repeat(64) })).file?.sentUnchanged).toBe(false);
  });

  test("no resume on the snapshot means no file panel", () => {
    expect(buildDossier(input({ resume: null })).file).toBeNull();
  });
});

describe("buildDossier provenance", () => {
  test("a recorded Fact traces an answer to its key and revision", () => {
    const dossier = buildDossier(
      input({
        answers: [
          {
            answer: "Toronto, ON",
            fact_key: "current_city",
            fact_revision: 3,
            kind: "fact",
            label: "City",
            question_id: "q1",
            resume_line_ids: [],
          },
        ],
      }),
    );

    expect(dossier.factsTrace.answers).toEqual([
      {
        factKey: "current_city",
        factRevision: 3,
        label: "City",
        resumeLines: [],
        source: "fact",
        text: "Toronto, ON",
      },
    ]);
  });

  test("a learned answer keyed q: is typed here, not from a Fact", () => {
    const [row] = buildDossier(
      input({
        answers: [
          {
            answer: "Yes",
            fact_key: "q:sponsor",
            fact_revision: 1,
            kind: "open_text",
            label: "Will you need sponsorship?",
            question_id: "q2",
            resume_line_ids: [],
          },
        ],
      }),
    ).factsTrace.answers;

    expect(row?.source).toBe("typed");
    expect(row?.factKey).toBeNull();
  });

  test("a sentence citing a resume line traces to that line", () => {
    const [row] = buildDossier(
      input({
        coverLetter: [{ resume_line_ids: ["L2"], sentence: "I led the migration." }],
      }),
    ).factsTrace.letter;

    expect(row).toEqual({
      factKey: null,
      factRevision: null,
      label: null,
      resumeLines: [{ id: "L2", text: "Led migration to Go services" }],
      source: "resume",
      text: "I led the migration.",
    });
  });

  test("a typed sentence with no citation is typed here", () => {
    const [row] = buildDossier(
      input({
        coverLetter: [{ by_user: true, resume_line_ids: [], sentence: "I want to join." }],
      }),
    ).factsTrace.letter;

    expect(row?.source).toBe("typed");
  });

  test("a sentence with no citation and not typed by the user is untraced", () => {
    const [row] = buildDossier(
      input({
        coverLetter: [{ resume_line_ids: [], sentence: "Untraced claim." }],
      }),
    ).factsTrace.letter;

    expect(row?.source).toBe("none");
  });

  test("a file answer is the attachment, not a traced sentence", () => {
    const dossier = buildDossier(
      input({
        answers: [
          {
            answer: "Maya_Okafor_Resume.pdf",
            fact_key: null,
            fact_revision: null,
            kind: "file",
            label: "Resume",
            question_id: "q3",
            resume_line_ids: [],
          },
        ],
      }),
    );

    expect(dossier.factsTrace.answers).toHaveLength(0);
  });

  test("an empty snapshot has an empty trace", () => {
    const dossier = buildDossier(input());

    expect(dossier.factsTrace).toEqual({ answers: [], letter: [] });
  });
});

describe("buildDossier did not happen", () => {
  test("both lines hold when the file is unchanged and every sentence is sourced", () => {
    const dossier = buildDossier(
      input({
        coverLetter: [{ resume_line_ids: ["L1"], sentence: "Staff engineer." }],
      }),
    );

    expect(dossier.didNotHappen).toEqual(["file_not_changed", "nothing_invented"]);
  });

  test("the file line is withheld on a hash mismatch", () => {
    const dossier = buildDossier(
      input({
        coverLetter: [{ resume_line_ids: ["L1"], sentence: "Staff engineer." }],
        resumeSha256: "b".repeat(64),
      }),
    );

    expect(dossier.didNotHappen).toEqual(["nothing_invented"]);
  });

  test("the invention line is withheld when a sentence is untraced", () => {
    const dossier = buildDossier(
      input({
        coverLetter: [{ resume_line_ids: [], sentence: "Invented claim." }],
      }),
    );

    expect(dossier.didNotHappen).toEqual(["file_not_changed"]);
  });

  test("no sentences means nothing is claimed about invention", () => {
    expect(buildDossier(input()).didNotHappen).toEqual(["file_not_changed"]);
  });
});

describe("buildDossier schema", () => {
  test("the output satisfies the schema the Board parses", () => {
    const dossier = buildDossier(
      input({
        coverLetter: [{ by_user: true, resume_line_ids: [], sentence: "Typed by me." }],
      }),
    );

    expect(dossierSchema.parse(dossier)).toEqual(dossier);
  });
});
