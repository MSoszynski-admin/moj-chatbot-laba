import { deleteSession } from "@/lib/session";

export async function POST() {
  await deleteSession();
  return new Response(null, { status: 204 });
}
