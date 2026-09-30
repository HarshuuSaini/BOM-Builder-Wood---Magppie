import { CarcassBomBuilder } from "@/components/CarcassBomBuilder";

// Designer view: a clone of the builder where the cabinet codes are FETCHED from a Zoho
// Sales Order (reverse of the create flow) and exploded into the BoM / exports.
export default function DesignerPage() {
  return <CarcassBomBuilder soMode />;
}
