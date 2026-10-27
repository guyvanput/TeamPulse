import Link from "next/link";
export default function NotFound() {
  return <section className="card"><h1>Not found or access denied</h1><p>This resource is unavailable to your account.</p><Link href="/">Return to workspace</Link></section>;
}
