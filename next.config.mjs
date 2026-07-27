/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    proxyClientMaxBodySize: "30mb"
  },
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"]
};

export default nextConfig;
