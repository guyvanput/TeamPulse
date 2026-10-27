"use client";

import { useActionState } from "react";
import { addAction, addReview, addSession, type FormState } from "@/app/actions";

function Feedback({ state }: { state: FormState }) {
  return <div aria-live="polite" aria-atomic="true">
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.success && <p className="success" role="status">{state.success}</p>}
  </div>;
}

export function SessionForm({ teamId }: { teamId: string }) {
  const [state, action, pending] = useActionState(addSession, {});
  return <form action={action}>
    <input type="hidden" name="teamId" value={teamId} />
    <label>Session name<input name="title" required maxLength={160} placeholder="Weekly improvement conversation" /></label>
    <Feedback state={state} />
    <button disabled={pending}>{pending ? "Creating..." : "Create session"}</button>
  </form>;
}

export function ActionForm({ sessionId, members }: { sessionId: string; members: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addAction, {});
  return <form action={action}>
    <input type="hidden" name="sessionId" value={sessionId} />
    <label>Action title<input name="title" required maxLength={160} /></label>
    <label>Discussion context<textarea name="context" maxLength={4000} rows={3} /></label>
    <div className="form-grid">
      <label>Owner<select name="ownerId" required defaultValue=""><option value="" disabled>Select a team member</option>
        {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select></label>
      <label>Due date (optional)<input type="date" name="dueDate" /></label>
    </div>
    <Feedback state={state} />
    <button disabled={pending}>{pending ? "Saving..." : "Capture action"}</button>
  </form>;
}

export function ReviewForm({ sessionId, actionId }: { sessionId: string; actionId: string }) {
  const [state, action, pending] = useActionState(addReview, {});
  return <form action={action}>
    <input type="hidden" name="sessionId" value={sessionId} />
    <input type="hidden" name="actionId" value={actionId} />
    <label>Progress note<textarea name="note" required maxLength={4000} rows={2} /></label>
    <label>Resulting status<select name="status" defaultValue="IN_PROGRESS">
      <option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="DONE">Done</option>
    </select></label>
    <Feedback state={state} />
    <button disabled={pending}>{pending ? "Saving..." : "Record review"}</button>
  </form>;
}
