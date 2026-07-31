import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth/session";
import { TeamManager } from "@/components/team/TeamManager";

export default async function TeamPage() {
  if (!(await isAuthenticated())) redirect("/login?next=/team");
  return <TeamManager />;
}
