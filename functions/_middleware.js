import { isAuthenticated, json } from "./_shared.js";

const PUBLIC_PATHS = new Set([
  "/auth",
  "/auth.html",
  "/api/login",
  "/api/logout",
  "/favicon.ico",
  "/robots.txt",
]);

function isAssetPath(pathname) {
  return (
    pathname.startsWith("/static/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/images/") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".ico")
  );
}

function authRedirect(request) {
  const url = new URL(request.url);
  const next = `${url.pathname}${url.search}`;
  return Response.redirect(`${url.origin}/auth.html?next=${encodeURIComponent(next)}`, 302);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return context.next();
  if (!env.APP_PIN) return context.next();
  if (PUBLIC_PATHS.has(url.pathname) || isAssetPath(url.pathname)) return context.next();

  if (await isAuthenticated(request, env)) return context.next();

  if (url.pathname.startsWith("/api/")) {
    return json({ error: "PIN required" }, { status: 401 });
  }
  return authRedirect(request);
}
