import { Hono } from "hono";
import type { Env, UserContext } from "../types";

type Variables = { user: UserContext };

export const meRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

meRouter.get("/me", (c) => {
  const user = c.get("user");
  return c.json({ email: user.email, name: user.name });
});
