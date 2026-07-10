import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Proteção de primeira linha: sem cookie de sessão, redireciona para /login.
 * A validação real da sessão acontece no servidor (requireSession) — o cookie
 * aqui é só um filtro otimista, como recomenda a doc do Better Auth.
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/usuarios", "/api/apuracao/:path*"],
};
