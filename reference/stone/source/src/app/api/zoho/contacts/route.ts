import { NextRequest, NextResponse } from "next/server";
import { toApiError, zohoInventoryGet } from "@/lib/zoho";

export const dynamic = "force-dynamic";

type Contact = {
  contact_id: string;
  contact_name: string;
  contact_type?: string;
  company_name?: string;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contactType = searchParams.get("contact_type") || "vendor";
    const search = searchParams.get("search") || "";

    const params: Record<string, string | number | undefined> = {
      contact_type: contactType,
      per_page: 200,
    };
    if (search) params.search_text = search;

    const body = await zohoInventoryGet<{ contacts?: Contact[] }>("/contacts", params);
    return NextResponse.json({ contacts: body.contacts ?? [] });
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: 500 });
  }
}
