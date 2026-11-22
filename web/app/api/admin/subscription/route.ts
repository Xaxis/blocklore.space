import { SUBSCRIPTION_TOKEN } from "@blocklore/core/control";
import { seal } from "@blocklore/core/node/seal";
import { ownerFor } from "@/lib/admin/auth";
import { sendCommand } from "@/lib/admin/control";

// The owner connects the brain to their Claude subscription from the admin. The token is sealed here
// under CONTROL_KEY before it is queued, so Redis and the command log never hold it in clear; the
// daemon opens it, checks it with a one-turn session and only then saves it (brain/src/subscription.ts).
// Nothing here logs the request body.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await ownerFor(req);
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.replace(/\s+/g, "") : "";
  if (!SUBSCRIPTION_TOKEN.test(token))
    return Response.json(
      {
        error:
          "That is not a Claude subscription token. Run claude setup-token and paste what it prints (it starts with sk-ant-oat). An API key is never accepted.",
      },
      { status: 400 },
    );
  const key = process.env.CONTROL_KEY ?? "";
  if (key.length < 32)
    return Response.json({ error: "CONTROL_KEY is not set on the site." }, { status: 503 });
  try {
    const id = await sendCommand(session, {
      type: "subscription.connect",
      sealed: seal(key, token),
    });
    return Response.json({ id });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not queue the command." },
      { status: 503 },
    );
  }
}
