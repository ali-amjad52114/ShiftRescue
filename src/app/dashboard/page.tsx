import { redirect } from "next/navigation";

/** The old workflow dashboard now lives at /admin; the schedule is the product. */
export default function DashboardPage() {
  redirect("/admin");
}
