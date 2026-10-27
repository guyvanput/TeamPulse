import { signIn } from "@/auth";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <section className="hero card">
    <p className="eyebrow">FROM CONVERSATION TO COMMITMENT</p>
    <h1>Make your next<br /><span>improvement stick.</span></h1>
    <p className="intro">A shared space to capture owned actions and revisit them next session.</p>
    {error && <p role="alert" className="error">Sign-in could not be completed. Check that the operator has provisioned your GitHub account, then try again.</p>}
    <form action={async () => { "use server"; await signIn("github", { redirectTo: "/" }); }}>
      <button>Sign in with GitHub</button>
    </form>
    <p className="muted">Access is limited to explicitly provisioned demonstration teams.</p>
  </section>;
}
