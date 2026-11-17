/** @type {import('next').NextConfig} */
const nextConfig = {
  // PGlite ships a WASM Postgres; keep it out of the server bundle so it loads from node_modules.
  serverExternalPackages: ['@electric-sql/pglite'],
  agentRules: false,
};
export default nextConfig;
