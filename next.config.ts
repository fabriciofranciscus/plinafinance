import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {
  /* config options here */
};

// F-M0-5: BotID (Vercel) — instala os rewrites de challenge/proxy. A verificação
// real só roda em deploy Vercel; em dev/local é no-op.
export default withBotId(nextConfig);
