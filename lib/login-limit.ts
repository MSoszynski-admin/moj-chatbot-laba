import "server-only";

// Liczniki żyją w pamięci jednego procesu: znikają po restarcie i nie są
// wspólne dla wielu instancji. To tylko lokalny hamulec. Na hostingu potrzebny
// jest dodatkowo limit po stronie platformy, na przykład reguła dla /api/login.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_CLIENT = 10;
const MAX_FAILURES_TOTAL = 100;
const TOTAL_KEY = "*";

type Bucket = { failures: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function activeBucket(key: string, now: number) {
  const bucket = buckets.get(key);
  if (bucket && bucket.resetAt <= now) {
    buckets.delete(key);
    return undefined;
  }
  return bucket;
}

function recordFailure(key: string, now: number) {
  const bucket = activeBucket(key, now);
  if (bucket) {
    bucket.failures += 1;
  } else {
    buckets.set(key, { failures: 1, resetAt: now + WINDOW_MS });
  }
}

// Ostatni wpis dopisuje najbliższe proxy. Nagłówek można sfałszować, gdy aplikacja
// stoi bez proxy, dlatego limit łączny nie zależy od adresu klienta.
export function getClientKey(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  return forwardedFor?.split(",").at(-1)?.trim() || "unknown";
}

export function getRetryAfterSeconds(client: string) {
  const now = Date.now();
  const limits: [string, number][] = [
    [client, MAX_FAILURES_PER_CLIENT],
    [TOTAL_KEY, MAX_FAILURES_TOTAL],
  ];

  for (const [key, limit] of limits) {
    const bucket = activeBucket(key, now);
    if (bucket && bucket.failures >= limit) {
      return Math.ceil((bucket.resetAt - now) / 1000);
    }
  }

  return 0;
}

export function recordFailedLogin(client: string) {
  const now = Date.now();
  recordFailure(client, now);
  recordFailure(TOTAL_KEY, now);
}
