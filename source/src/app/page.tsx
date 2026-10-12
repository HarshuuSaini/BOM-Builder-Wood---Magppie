import { redirect } from "next/navigation";
import { requireUser } from "@/lib/user-session";

export default async function Home() {
  await requireUser();
  redirect("/materials");
}
