import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  // Raccourcis que l'on tape de mémoire : l'espace organisateur vit sous /org,
  // mais /dashboard et /login sont ce qui vient naturellement sous les doigts.
  async redirects() {
    return [
      { source: "/dashboard", destination: "/org/dashboard", permanent: false },
      { source: "/login", destination: "/org/login", permanent: false },
      { source: "/org", destination: "/org/dashboard", permanent: false },
    ];
  },
};

export default nextConfig;
