import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE = "njv_session";

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((v) => v.trim().split("=", 2)).filter(([k]) => k));
}

export class Auth {
  constructor(private readonly password: string, private readonly secret: string, private readonly secure = process.env.NODE_ENV === "production") {
    if (password.length < 12) throw new Error("NJV_ADMIN_PASSWORD must be at least 12 characters");
    if (Buffer.byteLength(secret) < 32) throw new Error("NJV_SESSION_SECRET must be at least 32 bytes");
  }

  verifyPassword(candidate: string) {
    const a = Buffer.from(candidate); const b = Buffer.from(this.password);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  issue(res: Response) {
    const expires = Date.now() + 12 * 60 * 60 * 1000;
    const body = Buffer.from(JSON.stringify({ expires })).toString("base64url");
    const sig = createHmac("sha256", this.secret).update(body).digest("base64url");
    res.cookie(COOKIE, `${body}.${sig}`, { httpOnly: true, sameSite: "strict", secure: this.secure, maxAge: 12 * 60 * 60 * 1000, path: "/" });
  }

  clear(res: Response) { res.clearCookie(COOKIE, { httpOnly: true, sameSite: "strict", secure: this.secure, path: "/" }); }

  isAuthenticated(req: Request) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return false;
    const [body, sig] = token.split(".");
    if (!body || !sig) return false;
    const expected = createHmac("sha256", this.secret).update(body).digest("base64url");
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    try { return Number(JSON.parse(Buffer.from(body, "base64url").toString()).expires) > Date.now(); } catch { return false; }
  }

  require = (req: Request, res: Response, next: NextFunction) => this.isAuthenticated(req) ? next() : res.status(401).json({ error: "Authentication required" });
}

export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch { /* rejected below */ }
  return res.status(403).json({ error: "Cross-origin request rejected" });
}
