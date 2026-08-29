import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import {
  getLockConfig, getSetting, hashSecret, verifySecret, setSetting,
  UNLOCK_COOKIE, RECOVERY_COOKIE,
} from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → lock config + state. Never leaks the mobile's middle digits. */
export async function GET() {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const cfg = await getLockConfig();
  const unlocked = !cfg.any || store.get(UNLOCK_COOKIE)?.value === "1";
  return NextResponse.json({
    locked: !unlocked,
    config: {
      pin: cfg.pin,
      pattern: cfg.pattern,
      password: cfg.password,
      question: cfg.question,
      any: cfg.any,
      otp: cfg.otp,
      otpMobile: cfg.otpMobile ? maskMobile(cfg.otpMobile) : null,
    },
  });
}

const maskMobile = (m: string) => (m.length >= 6 ? m.slice(0, 2) + "•••••" + m.slice(-3) : "••••");

type Action =
  | { action: "setup"; kind: "pin" | "pattern" | "password"; value: string; question?: string; answer?: string }
  | { action: "verify"; kind: "pin" | "pattern" | "password"; value: string }
  | { action: "verify-otp"; value: string }
  | { action: "otp-config"; enable: boolean; mobile?: string }
  | { action: "logout" }
  | { action: "recover"; answer: string }
  | { action: "reset"; kind: "pin" | "pattern" | "password"; value: string };

function validValue(kind: "pin" | "pattern" | "password", value: string): boolean {
  if (kind === "pin") return /^\d{4}$/.test(value);
  if (kind === "pattern") return /^[1-9](-[1-9]){3,8}$/.test(value);
  return value.length >= 6;
}

function unlockResponse(ok: boolean, extra: Record<string, unknown> = {}, status?: number) {
  const res = NextResponse.json({ ok, ...extra }, { status: status ?? (ok ? 200 : 403) });
  if (ok) {
    res.cookies.set(UNLOCK_COOKIE, "1", { httpOnly: true, path: "/", maxAge: 60 * 60 * 12, sameSite: "lax" });
  }
  return res;
}

/** Generate + "send" the OTP (webhook/SMS provider pluggable; echoed in dev). */
async function dispatchOtp(mobile: string): Promise<string> {
  const code = String(randomInt(100000, 999999));
  await setSetting("otpHash", hashSecret(code));
  await setSetting("otpExpires", String(Date.now() + 5 * 60 * 1000));
  const webhook = process.env.SMS_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: mobile, text: `Smart Tijori OTP: ${code}` }),
      });
    } catch {
      /* provider failure is non-fatal: code still in server log */
    }
  }
  console.log(`[Smart Tijori] OTP for ${maskMobile(mobile)}: ${code}`);
  return code;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Action;

  if (body.action === "setup") {
    if (!validValue(body.kind, body.value ?? "")) {
      return NextResponse.json({ ok: false, error: "invalid_value" }, { status: 400 });
    }
    await setSetting(`${body.kind}Hash`, hashSecret(body.value));
    if (body.question && body.answer) {
      await setSetting("securityQuestion", body.question.trim());
      await setSetting("securityAnswerHash", hashSecret(body.answer));
    }
    return unlockResponse(true);
  }

  if (body.action === "verify") {
    const stored = await getSetting(`${body.kind}Hash`);
    if (!stored || !verifySecret(body.value ?? "", stored)) return unlockResponse(false);
    // 2FA gate: OTP configured → issue a challenge instead of unlocking
    const cfg = await getLockConfig();
    if (cfg.otp && cfg.otpMobile) {
      const code = await dispatchOtp(cfg.otpMobile);
      // Without an SMS provider configured, echo the code so the family admin
      // can read it on this machine; with SMS_WEBHOOK_URL set it's never leaked.
      return NextResponse.json(
        { ok: false, otpRequired: true, devOtp: process.env.SMS_WEBHOOK_URL ? undefined : code },
        { status: 200 },
      );
    }
    return unlockResponse(true);
  }

  if (body.action === "verify-otp") {
    const hash = await getSetting("otpHash");
    const expires = parseInt((await getSetting("otpExpires")) ?? "0", 10);
    if (!hash || Date.now() > expires || !verifySecret(body.value ?? "", hash)) return unlockResponse(false);
    await setSetting("otpHash", "used");
    return unlockResponse(true);
  }

  if (body.action === "otp-config") {
    const mobile = (body.mobile ?? "").replace(/\D/g, "").slice(-10);
    await setSetting("otpEnabled", body.enable && mobile.length === 10 ? "1" : "0");
    if (mobile.length === 10) await setSetting("otpMobile", mobile);
    return NextResponse.json({ ok: true, enabled: body.enable && mobile.length === 10 });
  }

  if (body.action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(UNLOCK_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  }

  if (body.action === "recover") {
    const stored = await getSetting("securityAnswerHash");
    if (!stored || !verifySecret(body.answer ?? "", stored)) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(RECOVERY_COOKIE, "1", { httpOnly: true, path: "/", maxAge: 300, sameSite: "lax" });
    return res;
  }

  if (body.action === "reset") {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    if (store.get(RECOVERY_COOKIE)?.value !== "1") {
      return NextResponse.json({ ok: false, error: "no_recovery" }, { status: 403 });
    }
    if (!validValue(body.kind, body.value ?? "")) {
      return NextResponse.json({ ok: false, error: "invalid_value" }, { status: 400 });
    }
    await setSetting(`${body.kind}Hash`, hashSecret(body.value));
    const res = unlockResponse(true);
    res.cookies.set(RECOVERY_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
