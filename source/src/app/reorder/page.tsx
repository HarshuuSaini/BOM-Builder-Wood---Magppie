import { ReorderReport } from "@/components/ReorderReport";
import { requireUser } from "@/lib/user-session";

export default async function ReorderPage() {
  await requireUser();
  return <ReorderReport />;
}
