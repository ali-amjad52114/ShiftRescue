import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ margin: "4rem auto", maxWidth: 720, padding: "0 1.5rem" }}>
      <h1>ShiftRescue</h1>
      <p>A voice-first hackathon demo for filling one uncovered shift.</p>
      <Link href="/dashboard">Open the workflow dashboard</Link>
    </main>
  );
}
