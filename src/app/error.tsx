"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="card"><h1>Something went wrong</h1>
    <p role="alert">TeamPulse could not load this page. Check the application and database, then retry.</p>
    <button onClick={reset}>Try again</button>
  </section>;
}
