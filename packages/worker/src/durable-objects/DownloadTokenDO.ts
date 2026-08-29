interface TokenState {
  key: string;
  used: boolean;
  expiresAt: number;
}

/**
 * DownloadTokenDO — Durable Object that enforces strict single-use download tokens.
 *
 * Because the Cloudflare runtime serializes all requests to a single DO instance,
 * the /consume handler is inherently race-free: only one consume can run at a time
 * per token, so the check-and-mark-used sequence requires no additional locking.
 *
 * Lifecycle:
 *   PUT  /init    — create token with 1-hour TTL, schedule alarm for cleanup
 *   POST /consume — atomically mark used, return {key} or 410
 *   alarm()       — delete all storage (TTL self-cleanup)
 */
export class DownloadTokenDO {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "PUT" && url.pathname === "/init") {
      const body = await request.json<{ key: string }>();
      const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

      const tokenState: TokenState = { key: body.key, used: false, expiresAt };
      await this.state.storage.put("state", tokenState);
      await this.state.storage.setAlarm(expiresAt);

      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/consume") {
      const tokenState = await this.state.storage.get<TokenState>("state");

      if (!tokenState) {
        return Response.json({ error: "Token not found" }, { status: 410 });
      }

      if (tokenState.used || Date.now() > tokenState.expiresAt) {
        return Response.json(
          { error: "Token already used or expired" },
          { status: 410 }
        );
      }

      tokenState.used = true;
      await this.state.storage.put("state", tokenState);

      return Response.json({ key: tokenState.key });
    }

    return new Response("Not Found", { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}
