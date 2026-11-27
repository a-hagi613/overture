/**
 * Runtime reasons that take a Posting out of candidate matching without changing the catalog (issue #576).
 * The catalog is legacy read-only job data for Applications created before freehire (#700), so a posting that keeps
 * failing on the live form is flagged in `app.sqlite` instead.
 */
export const POSTING_FLAG_REASONS = ["unsupported_login_required", "employer_form_failed"] as const;

export type PostingFlagReason = (typeof POSTING_FLAG_REASONS)[number];

const POSTING_FLAG_THRESHOLDS: Readonly<Record<PostingFlagReason, number>> = {
  employer_form_failed: 2,
  unsupported_login_required: 1,
};

/**
 * A flag row exists from the first failure so `fail_count` can reach the threshold; the Posting is only excluded
 * once it is at or over the threshold for its latest reason. A login wall is structural — the same Posting asks for
 * the same account next time — so the first failure flags it. A changed or broken employer form is often transient,
 * so it takes two failures before the Posting leaves the pool.
 * @param reason the reason recorded with the failure
 * @param failCount how many failures the row has accumulated
 * @returns whether candidate matching must skip the Posting
 */
export function isPostingFlagged(reason: PostingFlagReason, failCount: number) {
  return failCount >= POSTING_FLAG_THRESHOLDS[reason];
}
