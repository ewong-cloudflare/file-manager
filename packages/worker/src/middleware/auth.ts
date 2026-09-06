import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env, UserContext } from "../types";

type Variables = { user: UserContext };

let cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(teamDomain: string) {
  if (!cachedJWKS) {
    cachedJWKS = createRemoteJWKSet(
      new URL(`https://${teamDomain}/cdn-cgi/access/certs`)
    );
  }
  return cachedJWKS;
}

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const token = c.req.header("CF-Access-Jwt-Assertion");
    if (!token) {
      return c.json({ error: "Unauthorized — missing CF Access JWT" }, 401);
    }

    try {
      const JWKS = getJWKS(c.env.CF_TEAM_DOMAIN);
      const { payload } = await jwtVerify(token, JWKS, {
        audience: c.env.CF_ACCESS_AUD,
      });

      c.set("user", {
        email: (payload.email as string) ?? "",
        name: (payload.name as string) ?? (payload.email as string) ?? "",
        sub: payload.sub ?? "",
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return c.json({ error: "Unauthorized — invalid CF Access JWT", reason }, 401);
    }

    await next();
  }
);
