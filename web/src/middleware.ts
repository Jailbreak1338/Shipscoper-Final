import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Simple in-memory rate limiting (use Redis in production for multi-instance setups)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

// Periodically prune expired entries to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) rateLimitMap.delete(key);
  }
}, 120_000);

function checkRateLimit(
  ip: string,
  maxRequests = 100,
  windowMs = 60000
): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Create Supabase client
  const supabase = createMiddlewareClient({ req, res });

  // Get IP address for rate limiting.
  // On Vercel, req.ip is set by the edge network and cannot be spoofed.
  // We deliberately avoid trusting X-Forwarded-For from the client to prevent
  // rate-limit bypass attacks via IP header spoofing.
  const ip = req.ip ?? 'unknown';

  // Rate limiting (100 requests per minute)
  if (!checkRateLimit(ip, 100, 60000)) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  }

  // Security headers
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-XSS-Protection', '1; mode=block');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=()'
  );
  // HSTS: force HTTPS for 1 year, include subdomains
  res.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );
  // CSP: removed unsafe-eval (not required in Next.js production builds)
  res.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data: https:; " +
      "font-src 'self' data: https://fonts.gstatic.com; " +
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co;"
  );

  // Get session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const path = req.nextUrl.pathname;

  // Public paths (always allow)
  const publicPaths = ['/login', '/auth/callback', '/set-password', '/_next', '/favicon.ico', '/api/health'];
  if (publicPaths.some((p) => path.startsWith(p))) {
    // If logged in and visiting /login, redirect to app
    if (path.startsWith('/login') && session) {
      return NextResponse.redirect(new URL('/eta-updater', req.url));
    }
    return res;
  }

  // Dev-only paths
  if (path.startsWith('/api/dev/')) {
    return res;
  }

  // Protected paths - require authentication
  const protectedPaths = [
    '/eta-updater',
    '/dashboard',
    '/schedule-search',
    '/api/schedule-search',
    '/admin',
    '/api/update-excel',
    '/api/download',
  ];
  const isProtected = protectedPaths.some((p) => path.startsWith(p));

  if (isProtected && !session) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only paths
  if (path.startsWith('/admin') || path.startsWith('/api/admin')) {
    if (!session) {
      return NextResponse.redirect(new URL('/login', req.url));
    }

    // Use service-role client to bypass RLS for the role check.
    // The middleware client doesn't reliably set auth.uid() for RLS queries.
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: roleData } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .single();

    if (roleData?.role !== 'admin') {
      return NextResponse.redirect(new URL('/eta-updater', req.url));
    }
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
