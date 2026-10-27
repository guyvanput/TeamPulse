import Link from "next/link";
import { requireActor } from "@/lib/actor";
import { listTeams } from "@/lib/service";
import { SessionForm } from "@/components/forms";

export default async function Home() {
  const teams = await listTeams(await requireActor());
  return <>
    <p className="eyebrow">YOUR TEAM WORKSPACE</p>
    <h1>Good conversations.<br /><span>Lasting improvements.</span></h1>
    <p className="intro">Capture a commitment today. Bring it back into your next conversation.</p>
    {!teams.length && <div className="card"><h2>No team access yet</h2><p>Ask the demonstration operator to provision your GitHub account.</p></div>}
    {teams.map((team) => <section className="card" key={team.id}>
      <h2>{team.name}</h2><div className="columns">
        <div><h3>Start a conversation</h3><SessionForm teamId={team.id} /></div>
        <div><h3>Session history</h3>
          {team.sessions.length ? <ul className="session-list">{team.sessions.map((session) =>
            <li key={session.id}><Link href={`/sessions/${session.id}`}>{session.title}</Link>
              <small>{session.createdAt.toISOString().slice(0, 10)}</small></li>)}</ul> : <p>No sessions yet. Start your first one.</p>}
        </div>
      </div>
    </section>)}
  </>;
}
