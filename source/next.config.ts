import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/pdf-worker": ["./node_modules/pdfjs-dist/build/pdf.worker.min.mjs"],
  },
};

export default nextConfig;
