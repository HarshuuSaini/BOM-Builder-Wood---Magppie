import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { messages, context } = await req.json();

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API Key not configured on the server." },
        { status: 500 }
      );
    }

    const systemPrompt = `You are the Magppie BOM Copilot, an advanced AI assistant integrated into Magppie's Custom Cabinet Bill of Materials (BOM) & Inventory Management system.
Your goal is to assist the user in analyzing BOM data, verifying specs, estimating materials, and planning custom cabinet constructions.

Here is some foundational system context:
- Zones represent cabinet locations: BC/BCL (Base), BB/BBL (Blind Base), WC/WB (Wall), TC/TCL (Tall), LO/LB (Loft).
- Shutter designs: MD1, MD2, MD1CM1, MD1CM2, MD2CM1, MD2CM2, CL1, CL2, NEON20.
- Key Rule: CM1/2 and CL1/2 styles are EXCLUDED for low-back drawer fronts (H90) and 150mm wide Bottle Pull Outs (BPO).
- Key Rule: NEON20 is never allowed on drawer fronts.
- Waste factors: 17% for carcass panels, 0% for shutter panels, 20% for Elenor profiles, 25% for other profiles, 15% for stone.

Current application context provided by the page:
${JSON.stringify(context || {}, null, 2)}

Be concise, helpful, and technically accurate. Format your responses in Markdown.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `OpenAI API error: ${errText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      message: data.choices[0].message.content,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
