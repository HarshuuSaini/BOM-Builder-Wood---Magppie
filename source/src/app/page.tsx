import { redirect } from "next/navigation";
import { requireUser } from "@/lib/user-session";
import { costingPortalEnabled } from "@/lib/costing-storage-mode";

export default async function Home() {
  await requireUser();
  redirect(costingPortalEnabled() ? "/costings" : "/materials");
}
