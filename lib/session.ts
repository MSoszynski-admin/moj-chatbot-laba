import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";

const COOKIE_NAME = "chat_session";
const SESSION_SECONDS = 8 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : undefined;
}

function getChatPassword() {
  return process.env.CHAT_PASSWORD?.trim() || undefined;
}

function sign(expires: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`chat-session:${expires}`)
    .digest("base64url");
}

// Skróty mają równą długość, a porównanie trwa tyle samo niezależnie od treści.
function safeEqual(a: string, b: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function isAuthConfigured() {
  return Boolean(getChatPassword() && getSessionSecret());
}

export function isPasswordCorrect(password: string) {
  const expected = getChatPassword();
  return expected !== undefined && safeEqual(password, expected);
}

export async function createSession() {
  const secret = getSessionSecret();
  if (!secret) throw new Error("Brak SESSION_SECRET");

  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);

  (await cookies()).set(COOKIE_NAME, `${expires}.${sign(expires, secret)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE_NAME);
}

export async function hasSession() {
  // Wynik zależy od żądania i bieżącego czasu, więc nie może trafić do prerenderu.
  // To musi być pierwsza linia: wcześniejszy return przy braku zmiennych zapisałby
  // w buildzie ekran logowania jako statyczny i sesja nigdy nie byłaby sprawdzana.
  await connection();

  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const secret = getSessionSecret();
  if (!secret || !isAuthConfigured()) return false;

  const [expires, signature] = token?.split(".") ?? [];
  if (!expires || !signature) return false;

  return (
    safeEqual(signature, sign(expires, secret)) &&
    Number(expires) > Date.now() / 1000
  );
}
