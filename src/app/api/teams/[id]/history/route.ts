import { auth } from "@/auth";
import { listSessionHistory, UserError } from "@/lib/service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  try {
    const page = await listSessionHistory(session.user.id, {
      teamId: (await params).id, filter: query.get("filter") ?? undefined, cursor: query.get("cursor") ?? undefined
    });
    return Response.json(page, { headers });
  } catch (error) {
    if (error instanceof UserError && error.kind === "denied") return Response.json({ error: "Team not found or access denied." }, { status: 404, headers });
    if (error instanceof UserError) return Response.json({ error: error.message }, { status: 400, headers });
    console.error("TeamPulse session history failed unexpectedly.");
    return Response.json({ error: "History unavailable. Please retry." }, { status: 500, headers });
  }
}
