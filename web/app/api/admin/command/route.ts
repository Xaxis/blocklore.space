import { Command } from "@blocklore/core/control";
import { ocSignatureProblem } from "@blocklore/core/orangecheck";
import { ownerFor } from "@/lib/admin/auth";
import { readEmbargo, readReview, sendCommand } from "@/lib/admin/control";

// The owner's commands to the brain: checked here for shape (for review, against the queue the owner
// was shown; for signing, the pasted BIP-322 signatures), signed under CONTROL_KEY and queued for
// the daemon, which checks everything again.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await ownerFor(req);
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const p = Command.safeParse((await req.json().catch(() => null))?.cmd);
  if (!p.success)
    return Response.json(
      { error: "That is not a command the brain takes.", issues: p.error.issues.slice(0, 3) },
      { status: 400 },
    );
  const cmd = p.data;
  if (cmd.type === "subscription.connect")
    return Response.json(
      { error: "Send the token through the subscription form, which seals it." },
      { status: 400 },
    );
  if (cmd.type === "review.approve" || cmd.type === "review.reject") {
    const queue = new Map((await readReview()).map((i) => [i.id, i.hash]));
    const stale = cmd.items.filter((i) => queue.get(i.id) !== i.hash).map((i) => i.id);
    if (stale.length)
      return Response.json(
        {
          error: `${stale.length === 1 ? "A claim" : `${stale.length} claims`} changed or left the queue since this page loaded (${stale.slice(0, 3).join(", ")}). Reload and look again.`,
        },
        { status: 409 },
      );
  }
  if (cmd.type === "orangecheck.authorize" || cmd.type === "orangecheck.revoke") {
    const wrong = ocSignatureProblem(cmd);
    if (wrong) return Response.json({ error: wrong }, { status: 400 });
  }
  if (cmd.type === "embargo.decide" && !(await readEmbargo()).some((i) => i.id === cmd.id))
    return Response.json(
      { error: "That finding left the embargo since this page loaded. Reload and look again." },
      { status: 409 },
    );
  try {
    const id = await sendCommand(session, cmd);
    return Response.json({ id });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not queue the command." },
      { status: 503 },
    );
  }
}
