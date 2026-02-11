import type { RequestHandler } from "express";
import { nanoid } from "nanoid";

declare module "http" {
  interface IncomingMessage {
    requestId?: string;
  }
}

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const header = req.header("x-request-id");
  const requestId = header && header.trim().length > 0 ? header.trim() : nanoid();

  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
};
