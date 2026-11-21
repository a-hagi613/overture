import { copy } from "../../shared/copy.ts";
import { isDemoRole } from "../../shared/demo.ts";

export const DEMO_LOCKED_CODE = "demo_locked";

/**
 * The 403 every sensitive route returns for the demo account, so a visit can
 * never upload files, spend LLM money or delete/export data (#278, security
 * review of #304).
 * @param role The signed-in user's role.
 * @returns A 403 response for the demo account, or null for every other role.
 */
export function demoLocked(role: string | null | undefined) {
  if (!isDemoRole(role)) {
    return null;
  }

  return Response.json({ error: DEMO_LOCKED_CODE, message: copy.demo.locked }, { status: 403 });
}
