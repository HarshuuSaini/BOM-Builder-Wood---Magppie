import { BomDashboard } from "@/components/BomDashboard";
import { requireUser } from "@/lib/user-session";

export default async function Page() {
  await requireUser();
  return <BomDashboard />;
}
