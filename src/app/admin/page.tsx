import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth/session";
import { AdminConsole } from "@/components/admin/AdminConsole";

export default async function AdminPage() {
  if (!(await isAuthenticated())) redirect("/login?next=/admin");
  return <AdminConsole />;
}
