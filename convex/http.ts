// Real bills inbox (plan-agent.md step 2): "Anyone can email it, judges included." A common
// inbound-email webhook shape (from/subject/text — SendGrid's Inbound Parse, Postmark, etc. all
// map onto this) posts here, authenticated by a shared secret header so random traffic can't
// create bills.
import { httpRouter } from "convex/server";
import { api } from "./_generated/api.js";
import { httpAction } from "./_generated/server.js";

const http = httpRouter();

http.route({
  path: "/inbound-email",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.INBOUND_EMAIL_SECRET;
    if (!secret) throw new Error("INBOUND_EMAIL_SECRET is not set");
    if (request.headers.get("x-hold-secret") !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const body = payload as Record<string, unknown>;
    const from = typeof body.from === "string" ? body.from : "";
    const subject = typeof body.subject === "string" ? body.subject : "";
    const text = typeof body.text === "string" ? body.text : "";
    if (!from || !text) return new Response("Missing from/text", { status: 400 });

    const result = await ctx.runAction(api.app.intake.ingestEmail, {
      from,
      subject,
      body: text,
      receivedAt: new Date().toISOString(),
    });
    return Response.json(result);
  }),
});

export default http;
