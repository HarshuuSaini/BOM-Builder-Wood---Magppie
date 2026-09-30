import { NextRequest, NextResponse } from "next/server";
import { toApiError, zohoInventoryGet } from "@/lib/zoho";

export const dynamic = "force-dynamic";

type ZohoCf = { api_name?: string; placeholder?: string; label?: string; value?: unknown; value_formatted?: string };

type Contact = {
  contact_id: string;
  contact_name: string;
  custom_field_hash?: Record<string, unknown>;
  custom_fields?: ZohoCf[];
};

function readCf(record: Contact | null | undefined, ...keys: string[]): string {
  if (!record) return "";
  const rec = record as unknown as Record<string, unknown>;
  const hash = (rec.custom_field_hash ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    if (hash[k] != null && hash[k] !== "") return String(hash[k]);
    const direct = rec[k];
    if (direct != null && direct !== "") return String(direct);
  }
  const cfs = (rec.custom_fields ?? []) as ZohoCf[];
  for (const cf of cfs) {
    const ok = keys.some(
      (k) =>
        cf.api_name === k ||
        cf.placeholder === k ||
        cf.label?.toLowerCase() === k.toLowerCase(),
    );
    if (!ok) continue;
    const v = cf.value ?? cf.value_formatted;
    if (v != null && v !== "") return String(v);
  }
  return "";
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await zohoInventoryGet<{ contact?: Contact }>(`/contacts/${encodeURIComponent(id)}`);
    if (!body.contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    const leadTime = Number(readCf(body.contact, "cf_lead_time", "cf_leadtime", "Lead Time", "lead_time")) || 0;
    const transitTime =
      Number(readCf(body.contact, "cf_transit_time", "cf_transittime", "Transit Time", "transit_time")) || 0;
    return NextResponse.json({
      contact: { contact_id: body.contact.contact_id, contact_name: body.contact.contact_name },
      lead_time: leadTime,
      transit_time: transitTime,
    });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
