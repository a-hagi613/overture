import { describe, expect, test } from "bun:test";

import { timelineReasonText, workModeText } from "./board-format.ts";

describe("the drawer's work mode label", () => {
  test("says the workplace when the catalog has one", () => {
    expect(workModeText("remote")).toBe("Remote");
    expect(workModeText("hybrid")).toBe("Hybrid");
    expect(workModeText("onsite")).toBe("On-site");
  });

  test("never guesses when freehire left the work mode blank", () => {
    expect(workModeText(null)).toBe("Work mode not stated");
  });
});

describe("the drawer's timeline reasons", () => {
  test("turns a recorded wait into a plain sentence", () => {
    expect(timelineReasonText("retry_scheduled")).toBe(
      "A send was interrupted and queued for the next sending slot.",
    );
    expect(timelineReasonText("confirm_wait_elapsed")).toBe(
      "The employer's confirmation did not arrive in time, so it was not sent again.",
    );
    expect(timelineReasonText("dry_submit")).toBe(
      "This was a local dry run: the form was filled and the proof kept, nothing was sent.",
    );
  });

  test("keeps a check-in's answer and a mail move readable", () => {
    expect(timelineReasonText("checkin:interested")).toBe("You answered a check-in: interested.");
    expect(timelineReasonText("checkin:no_response")).toBe("The employer did not reply.");
    expect(timelineReasonText("mail:screening")).toBe("An employer reply moved this application.");
    expect(timelineReasonText("posting_identity:title")).toBe(
      "The page did not match the job that was picked, so nothing was sent.",
    );
  });

  test("falls back to the failure sentence and never shows a machine token", () => {
    expect(timelineReasonText("form_changed")).toBe(
      "The form changed after it was filled in, so nothing was sent.",
    );
    expect(timelineReasonText("something_new")).toBeNull();
    expect(timelineReasonText(null)).toBeNull();
  });
});
