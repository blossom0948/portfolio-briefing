import { clearAuthCookie, json } from "../_shared.js";

export async function onRequestPost() {
  return json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": clearAuthCookie(),
      },
    },
  );
}
