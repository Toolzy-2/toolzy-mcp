/** @type {import('next').NextConfig} */
const nextConfig = {
  // Le SDK MCP + supabase-js tournent en runtime Node.js (voir route.ts).
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
  // URLs publiques propres : mcp.toolzy.io/mcp → /api/mcp (le [transport]).
  // NB : pour Next.js, les rewrites doivent être ici (vercel.json est ignoré).
  async rewrites() {
    return [
      { source: "/mcp", destination: "/api/mcp" },
      { source: "/sse", destination: "/api/sse" },
    ];
  },
};

export default nextConfig;
