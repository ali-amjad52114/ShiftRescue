"use client";

import { useEffect, useState } from "react";
import { ShiftCard } from "@/components/dashboard/ShiftCard";
import { WorkerStatus } from "@/components/dashboard/WorkerStatus";
import { WorkflowTimeline } from "@/components/dashboard/WorkflowTimeline";
import { ProofPanel } from "@/components/dashboard/ProofPanel";

interface StatusResponse {
  status: string;
  shift: any;
  currentWorker: string | null;
  language: string | null;
  timeline: Array<{ id: string; message: string; timestamp: string }>;
  proof: any;
}

export default function HomePage() {
  const [data, setData] = useState<StatusResponse>({
    status: "WAITING_FOR_MANAGER_COMMAND",
    shift: null,
    currentWorker: null,
    language: null,
    timeline: [],
    proof: {},
  });

  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Error fetching status:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (res.ok) {
        await fetchStatus();
      }
    } catch (e) {
      console.error("Error resetting state:", e);
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="dashboard-container">
      <header className="dashboard-header">
        <div>
          <div className="brand-badge">
            <span className="pulse-dot"></span>
            ShiftRescue • Real-Time Engine
          </div>
          <h1 style={{ margin: "0.5rem 0 0 0", fontSize: "1.8rem" }}>Workflow Dashboard</h1>
        </div>
        <button
          className="reset-btn"
          onClick={handleReset}
          disabled={resetting}
        >
          {resetting ? "Resetting..." : "🔄 Reset Demo"}
        </button>
      </header>

      <div className="grid-layout">
        <ShiftCard shift={data.shift} status={data.status} />
        <WorkerStatus
          currentWorker={data.currentWorker}
          language={data.language}
          status={data.status}
        />
      </div>

      <div className="grid-layout">
        <WorkflowTimeline timeline={data.timeline} />
        <ProofPanel proof={data.proof} />
      </div>
    </main>
  );
}
