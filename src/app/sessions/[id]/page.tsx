import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/actor";
import { sessionDetails, UserError } from "@/lib/service";
import { statusLabels } from "@/lib/rules";
import { ActionForm, ReviewForm } from "@/components/forms";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const data = await sessionDetails(actor, id).catch((error: unknown) => {
    if (error instanceof UserError && error.kind === "denied") notFound();
    throw error;
  });
  return <>
    <Link href="/">Back to workspace</Link><p className="eyebrow">TEAM SESSION</p>
    <h1>{data.session.title}</h1>
    <p className="intro">First, revisit your commitments. Then capture what comes next.</p>
    <section className="card"><h2>Previous commitments</h2>
      <p className="muted">Unresolved actions from earlier sessions. Review each action once in this session.</p>
      {!data.priorActions.length && <p>No unresolved actions from earlier sessions.</p>}
      {data.priorActions.map((action) => <article className="action" key={action.id}>
        <div className="action-heading"><h3><Link href={`/actions/${action.id}`}>{action.title}</Link></h3><span className="badge">{statusLabels[action.status]}</span></div>
        <p>Owner: {action.owner.user.name ?? "Team member"}{action.dueDate && ` / Due: ${action.dueDate.toISOString().slice(0, 10)}`}</p>
        <p className="muted">From: {action.sourceSession.title}</p>
        {action.context && <p className="context">{action.context}</p>}
        {action.reviews.length ? <p className="success">Already reviewed in this session.</p> : <ReviewForm sessionId={id} actionId={action.id} />}
      </article>)}
    </section>
    <div className="columns">
      <section className="card"><h2>Capture an improvement</h2>
        <ActionForm sessionId={id} members={data.members.map(({ user }) => ({ id: user.id, name: user.name ?? "Team member" }))} />
      </section>
      <section className="card"><h2>Actions from this session</h2>
        {!data.actions.length && <p>No actions captured yet.</p>}
        {data.actions.map((action) => <article className="action" key={action.id}>
          <h3><Link href={`/actions/${action.id}`}>{action.title}</Link></h3>
          <p>{statusLabels[action.status]} / Owner: {action.owner.user.name ?? "Team member"}</p>
          {action.dueDate && <p>Due: {action.dueDate.toISOString().slice(0, 10)}</p>}
        </article>)}
      </section>
    </div>
    <section className="card"><h2>Reviews recorded here</h2>
      {!data.reviews.length && <p>No reviews recorded yet.</p>}
      {data.reviews.map((review) => <article className="action" key={review.id}>
        <h3><Link href={`/actions/${review.actionId}`}>{review.action.title}</Link></h3>
        <p className="context">{review.note}</p>
        <p>{statusLabels[review.resultingStatus]} / Reviewed by {review.actor.user.name ?? "Team member"}</p>
      </article>)}
    </section>
  </>;
}
