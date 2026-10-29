import { requireActor } from "@/lib/actor";
import { listSessionHistory, listTeams } from "@/lib/service";
import { SessionForm } from "@/components/forms";
import { SessionHistory } from "@/components/session-history";

export default async function Home() {
  const actor = await requireActor();
  const teams = await Promise.all((await listTeams(actor)).map(async (team) => ({
    ...team, history: await listSessionHistory(actor, { teamId: team.id, filter: "ALL" })
  })));
  return <>
    <p className="eyebrow">YOUR TEAM WORKSPACE</p>
    <h1>Good conversations.<br /><span>Lasting improvements.</span></h1>
    <p className="intro">Capture a commitment today. Bring it back into your next conversation.</p>
    {!teams.length && <div className="card"><h2>No team access yet</h2><p>Ask the demonstration operator to provision your GitHub account.</p></div>}
    {teams.map((team) => <section className="card" key={team.id}>
      <h2>{team.name}</h2><div className="columns">
        <div><h3>Start a conversation</h3><SessionForm teamId={team.id} />
          <h3>Collect discussion topics</h3><SessionForm teamId={team.id} facilitated />
        </div>
        <div><h3>Session history</h3>
          <SessionHistory teamId={team.id} initial={team.history} />
        </div>
      </div>
    </section>)}
  </>;
}
