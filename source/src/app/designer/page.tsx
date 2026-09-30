"use client";

import { WoodBomBuilder } from "@/components/WoodBomBuilder";
import { AuthGate } from "@/components/AuthGate";

export default function Page() {
  return (
    <AuthGate>
      <WoodBomBuilder soMode />
    </AuthGate>
  );
}
