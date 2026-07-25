import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pdf.js is a Node library used only server-side (lib/sources/m2u-history);
  // let Next require it at runtime rather than bundling it.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
