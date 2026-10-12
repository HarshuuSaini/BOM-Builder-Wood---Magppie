import { WoodBomBuilder } from "@/components/WoodBomBuilder";
import { requireUser, userSession, sessionMaterials } from "@/lib/user-session";
import { redirect } from "next/navigation";

export default async function Page() {
  await requireUser();
  const session = await userSession();
  if (!sessionMaterials(session)) redirect("/materials");
  return <WoodBomBuilder soMode materials={sessionMaterials(session)} />;
}
