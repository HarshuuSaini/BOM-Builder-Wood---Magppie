import { NextResponse } from "next/server";
import { getZohoRuntimeInfo, toApiError, zohoInventoryGet } from "@/lib/zoho";

export const dynamic = "force-dynamic";

type OrganizationsResponse = {
  organizations?: Array<{
    organization_id: string;
    name?: string;
    organization_name?: string;
  }>;
};

export async function GET() {
  try {
    const runtime = getZohoRuntimeInfo();
    const body = await zohoInventoryGet<OrganizationsResponse>("/organizations");
    const organization = body.organizations?.find((entry) => entry.organization_id === runtime.organizationId);

    return NextResponse.json({
      ok: true,
      organizationId: runtime.organizationId,
      organizationName: organization?.name ?? organization?.organization_name ?? "Zoho Inventory",
      inventoryBaseUrl: runtime.inventoryBaseUrl,
      tokenCached: runtime.tokenCached,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, ...toApiError(error), checkedAt: new Date().toISOString() }, { status: 500 });
  }
}
