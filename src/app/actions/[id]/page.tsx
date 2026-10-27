import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/actor";
import { actionDetails, UserError } from "@/lib/service";
import { statusLabels } from "@/lib/rules";

export default async function ActionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const action = await actionDetails(actor, id).catch((error: unknown) => {
    if (error instanceof UserError && error.kind === "denied") notFound();
    throw error;
  });
  return <>
    <Link href="/">Back to workspace</Link><p className="eyebrow">IMPROVEMENT HISTORY</p>
    <h1>{action.title}</h1>
    <section className="card"><span className="badge">{statusLabels[action.status]}</span>
      <p>Owner: {action.owner.user.name ?? "Team member"}</p>
      {action.dueDate && <p>Due: {action.dueDate.toISOString().slice(0, 10)}</p>}
      <p>Origin: <Link href={`/sessions/${action.sourceSessionId}`}>{action.sourceSession.title}</Link></p>
      <p className="context">{action.context || "No additional discussion context."}</p>
    </section>
    <section className="card"><h2>Review history</h2>
      {!action.reviews.length && <p>This commitment has not been reviewed yet.</p>}
      {action.reviews.map((review) => <article className="action" key={review.id}>
        <h3><Link href={`/sessions/${review.reviewSessionId}`}>{review.reviewSession.title}</Link></h3>
        <p className="context">{review.note}</p><p>{statusLabels[review.resultingStatus]} / {review.actor.user.name ?? "Team member"}</p>
        <small>{review.createdAt.toISOString()}</small>
      </article>)}
    </section>
  </>;
}
