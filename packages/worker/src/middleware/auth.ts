import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    // TODO: Replace with real Cloudflare Access JWT validation once CF_ACCESS_AUD is provided.
    // Production implementation should:
    //   1. Extract the `CF-Access-Jwt-Assertion` header
    //   2. Fetch JWKS from https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
    //   3. Verify the JWT signature and aud claim against c.env.CF_ACCESS_AUD
    //   4. Return 401 on failure

    if (c.env.ENVIRONMENT === "production") {
      const jwtAssertion = c.req.header("CF-Access-Jwt-Assertion");
      if (!jwtAssertion) {
        return c.json({ error: "Unauthorized — missing CF Access JWT" }, 401);
      }
      // Mock-pass for now; swap with real validation above when AUD is ready.
    }

    await next();
  }
);
