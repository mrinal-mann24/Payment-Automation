import express, { type Request } from "express";
import { renewalWebhookRouter } from "./routes/renewalWebhook.js";
import { razorpayWebhookRouter } from "./routes/razorpayWebhook.js";

export function createApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req: Request & { rawBody?: string }, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    }),
  );
  app.use(renewalWebhookRouter);
  app.use(razorpayWebhookRouter);
  return app;
}
