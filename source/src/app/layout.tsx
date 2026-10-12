import type { Metadata } from "next";
import "./globals.css";
import { AiCopilot } from "@/components/AiCopilot";

export const metadata: Metadata = {
  title: "BOM Backorder Report",
  description: "Zoho Inventory BOM backorder report widget",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <AiCopilot />
      </body>
    </html>
  );
}
