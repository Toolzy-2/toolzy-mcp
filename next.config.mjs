/** @type {import('next').NextConfig} */
const nextConfig = {
  // Le SDK MCP + supabase-js tournent en runtime Node.js (voir route.ts).
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
};

export default nextConfig;
