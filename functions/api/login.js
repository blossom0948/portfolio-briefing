import { authCookie, json } from "../_shared.js";

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.APP_PIN) return json({ ok: true, disabled: true });

  const body = await readBody(request);
  const pin = String(body.pin || "");
  if (!pin || pin !== String(env.APP_PIN)) {
    return json({ error: "PIN이 맞지 않습니다." }, { status: 401 });
  }

  return json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": await authCookie(env),
      },
    },
  );
}
