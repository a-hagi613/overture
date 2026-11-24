import { readHtmlForm } from "./html-form.ts";

/**
 * The Batch 4 boards whose apply page carries one ordinary guest form in its
 * first HTML response (issue #574). They share a label dictionary for the
 * standard profile controls; an employer's own questions keep the label the
 * page gives them, and the reader fails closed to an empty form when the
 * markup is not the one it was built for.
 */
export const BATCH_4_LABELS: ReadonlyMap<string, string> = new Map([
  ["first_name", "First name"],
  ["firstname", "First name"],
  ["firstName", "First name"],
  ["last_name", "Last name"],
  ["lastname", "Last name"],
  ["lastName", "Last name"],
  ["email", "Email"],
  ["email_address", "Email"],
  ["emailAddress", "Email"],
  ["phone", "Phone"],
  ["phone_number", "Phone"],
  ["phoneNumber", "Phone"],
  ["resume", "Resume"],
  ["resumeFile", "Resume"],
  ["cv", "Resume"],
]);

/**
 * Reads a Batch 4 application page over plain HTTP.
 *
 * @param rawHtml the server-rendered application page
 * @returns the form's questions, its signature, and any control it cannot fill
 */
export async function readBatch4FormHtml(rawHtml: string) {
  return readHtmlForm(rawHtml, { labels: BATCH_4_LABELS, path: "batch4_html" });
}
