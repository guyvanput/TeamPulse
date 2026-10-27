import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import "./globals.css";

export const metadata: Metadata = { title: "TeamPulse", description: "Turn discussions into owned improvements." };

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  return <html lang="en"><body>
    <header><Link className="brand" href="/">Team<span>Pulse</span></Link>
      {session?.user && <form action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
        <span className="identity">{session.user.name ?? "Team member"}</span><button className="secondary">Sign out</button>
      </form>}
    </header>
    <main>{children}</main>
    <footer>Discussions become commitments. Commitments become improvements.</footer>
  </body></html>;
}
