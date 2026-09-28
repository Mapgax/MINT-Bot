import { loeschCookie } from "../lib/session.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Nur POST erlaubt" });
  }
  res.setHeader("Set-Cookie", loeschCookie());
  return res.status(200).json({ ok: true });
}
