import { CarcassBomBuilder } from "@/components/CarcassBomBuilder";

// Planning view (clone of the Designer page for the planning team): same SO → BoM behaviour,
// plus (upcoming) an Excel cabinet-code upload where the designer chooses the shutter colour.
export default function PlanningPage() {
  return <CarcassBomBuilder soMode planningMode />;
}
