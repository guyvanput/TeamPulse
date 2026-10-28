import { auth } from "@/auth";
import { sessionSnapshot } from "@/lib/snapshot-service";
import { UserError } from "@/lib/service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
  try {
    return Response.json(await sessionSnapshot(session.user.id, (await params).id), { headers });
  } catch (error) {
    if (error instanceof UserError && error.kind === "denied") return Response.json({ error: "Session not found or access denied." }, { status: 404, headers });
    console.error("TeamPulse session snapshot failed unexpectedly.");
    return Response.json({ error: "Updates unavailable. Please retry." }, { status: 500, headers });
  }
}
