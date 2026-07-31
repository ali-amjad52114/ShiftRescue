import { ProofPanel } from "@/components/dashboard/ProofPanel";
import { ShiftCard } from "@/components/dashboard/ShiftCard";
import { WorkerStatus } from "@/components/dashboard/WorkerStatus";
import { WorkflowTimeline } from "@/components/dashboard/WorkflowTimeline";

export default function DashboardPage() {
  return (
    <main style={{ margin: "3rem auto", maxWidth: 900, padding: "0 1.5rem" }}>
      <h1>ShiftRescue Dashboard</h1>
      <p>Shared UI placeholders are ready for the live workflow connection.</p>
      <ShiftCard />
      <WorkerStatus />
      <WorkflowTimeline />
      <ProofPanel />
    </main>
  );
}
