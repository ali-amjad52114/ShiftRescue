import { LogsView } from "@/components/logs/LogsView";

export const metadata = {
  title: "Public Rescue Logs — ShiftRescue",
  description: "Live real-time operational rescue timeline, system events, and execution logs.",
};

export default function LogsPage() {
  return <LogsView />;
}
