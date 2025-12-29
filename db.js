import { kv } from "@vercel/kv";

export async function savePaste(paste) {
  await kv.set(`paste:${paste.id}`, paste);
}

export async function getPaste(id) {
  return await kv.get(`paste:${id}`);
}
