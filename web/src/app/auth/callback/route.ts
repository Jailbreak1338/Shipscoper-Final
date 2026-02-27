import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

function safeRedirect(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, req.url));
}

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');

  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        return safeRedirect(req, `/login?error=${encodeURIComponent('Ungültiger oder abgelaufener Link')}`);
      }
      return safeRedirect(req, '/set-password');
    }

    if (tokenHash && (type === 'invite' || type === 'recovery')) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
      if (error) {
        return safeRedirect(req, `/login?error=${encodeURIComponent('Ungültiger oder abgelaufener Link')}`);
      }
      return safeRedirect(req, '/set-password');
    }

    return safeRedirect(req, '/login');
  } catch {
    return safeRedirect(req, `/login?error=${encodeURIComponent('Authentifizierung fehlgeschlagen')}`);
  }
}
