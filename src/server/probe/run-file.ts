import { z } from "zod";

export const runFileQuestionSchema = z.object({
  id: z.string().min(1),
  value: z.string(),
  approved: z.boolean(),
});

export const GREENHOUSE_BOARD_ORIGIN = "https://job-boards.greenhouse.io";

export const runFilePostingSchema = z
  .object({
    board: z.string().min(1),
    jobId: z.string().min(1),
    url: z.url().optional(),
    company: z.string().min(1),
    title: z.string().min(1),
    resumeFieldId: z.string().min(1),
    questions: z.array(runFileQuestionSchema).min(1),
  })
  .refine(
    (posting) =>
      posting.url !== undefined ||
      URL.canParse(`${GREENHOUSE_BOARD_ORIGIN}/${posting.board}/jobs/${posting.jobId}`),
  );

export const runFileSchema = z.object({
  country: z.string().length(2),
  resumePath: z.string().min(1),
  postings: z.array(runFilePostingSchema).min(1),
});

export type RunFileQuestion = z.infer<typeof runFileQuestionSchema>;

export type RunFilePosting = z.infer<typeof runFilePostingSchema>;

export type RunFile = z.infer<typeof runFileSchema>;

export function postingUrl(posting: RunFilePosting, origin: string) {
  return posting.url ?? `${origin}/${posting.board}/jobs/${posting.jobId}`;
}
