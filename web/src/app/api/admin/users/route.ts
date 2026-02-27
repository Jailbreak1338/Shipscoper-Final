import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { z } from 'zod';

const createUserSchema = z.object({
  email: z.string().email('Invalid email'),
  role: z.enum(['admin', 'user']),
});

const updateRoleSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  role: z.enum(['admin', 'user']),
});

function mapCreateUserError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('already') || lower.includes('exists') || lower.includes('duplicate') || lower.includes('23505')) {
    return { status: 409, message: 'Benutzer existiert bereits.' };
  }

  if (lower.includes('invalid') || lower.includes('email')) {
    return { status: 400, message: 'Ungültige E-Mail-Adresse.' };
  }

  if (lower.includes('resend') || lower.includes('e-mail')) {
    return { status: 502, message: 'Einladung erstellt, aber E-Mail-Versand fehlgeschlagen.' };
  }

  if (lower.includes('unexpected_failure') || lower.includes('database error saving new user') || lower.includes('user_roles') || lower.includes('database') || lower.includes('relation')) {
    return { status: 500, message: 'Database error saving new user. Please verify Supabase trigger/function for user_roles.' };
  }

  return { status: 500, message: 'Benutzer konnte nicht angelegt werden.' };
}


async function getInviteLinkAndUserId(
  supabaseAdmin: Awaited<ReturnType<typeof import('@/lib/supabaseServer')['getSupabaseAdmin']>>,
  email: string
): Promise<{ userId: string; inviteUrl: string; reusedExistingUser: boolean }> {
  const normalizedEmail = email.trim().toLowerCase();

  const { data: listedUsers } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = listedUsers?.users.find((u) => (u.email ?? '').toLowerCase() === normalizedEmail) ?? null;

  if (existing?.id) {
    const { data: recoveryLinkData, error: recoveryLinkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
      });

    if (recoveryLinkError) throw recoveryLinkError;

    const inviteUrl = recoveryLinkData?.properties?.action_link;
    if (!inviteUrl) {
      throw new Error('Failed to generate recovery link for existing user.');
    }

    return { userId: existing.id, inviteUrl, reusedExistingUser: true };
  }

  const { data: inviteLinkData, error: inviteLinkError } =
    await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
    });

  if (inviteLinkError) throw inviteLinkError;

  const invitedUserId = inviteLinkData?.user?.id;
  const inviteUrl = inviteLinkData?.properties?.action_link;

  if (!invitedUserId || !inviteUrl) {
    throw new Error('Database error saving new user. Missing invite payload from auth service.');
  }

  return { userId: invitedUserId, inviteUrl, reusedExistingUser: false };
}


function getAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    'https://www.shipscoper.com'
  ).replace(/\/$/, '');
}

function withRedirectTo(actionLink: string): string {
  try {
    const url = new URL(actionLink);
    url.searchParams.set('redirect_to', `${getAppBaseUrl()}/auth/callback`);
    return url.toString();
  } catch {
    return actionLink;
  }
}


function buildPasswordSetupLink(actionLink: string, type: 'invite' | 'recovery'): string {
  const fallback = withRedirectTo(actionLink);
  try {
    const parsed = new URL(actionLink);
    const tokenHash = parsed.searchParams.get('token_hash') || parsed.searchParams.get('token');
    if (!tokenHash) return fallback;
    const callback = new URL('/auth/callback', getAppBaseUrl());
    callback.searchParams.set('token_hash', tokenHash);
    callback.searchParams.set('type', type);
    return callback.toString();
  } catch {
    return fallback;
  }
}

 
async function isAdmin(userId: string): Promise<boolean> {
  // Use service-role client to bypass RLS for the role check
  const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
  const admin = getSupabaseAdmin();

  const { data } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  return (data as { role: string } | null)?.role === 'admin';
}

// GET: List all users
export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
    const supabaseAdmin = getSupabaseAdmin();

    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, role, created_at');

    if (usersError) throw usersError;

    // Get auth.users data via admin API
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();

    // Count uploads per user
    const { data: logs } = await supabaseAdmin
      .from('upload_logs')
      .select('user_id');

    const uploadCounts: Record<string, number> = {};
    if (logs) {
      for (const log of logs) {
        uploadCounts[log.user_id] = (uploadCounts[log.user_id] || 0) + 1;
      }
    }

    const combinedUsers = (users ?? []).map((userRole) => {
      const authUser = authUsers?.users.find(
        (u) => u.id === userRole.user_id
      );
      return {
        id: userRole.user_id,
        email: authUser?.email || 'Unknown',
        role: userRole.role,
        created_at: userRole.created_at,
        last_sign_in: authUser?.last_sign_in_at ?? null,
        upload_count: uploadCounts[userRole.user_id] || 0,
      };
    });

    return NextResponse.json({ users: combinedUsers });
  } catch (error) {
    console.error('Error fetching users:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Create new user
export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { email, role } = createUserSchema.parse(body);

    const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
    const supabaseAdmin = getSupabaseAdmin();

    // Existing emails: use recovery link; new emails: invite link.
    // This avoids flaky AuthApiError('Database error saving new user') on duplicate/inconsistent invite attempts.
    const { userId, inviteUrl: inviteActionUrl, reusedExistingUser } = await getInviteLinkAndUserId(supabaseAdmin, email);
    const inviteLink = buildPasswordSetupLink(inviteActionUrl, reusedExistingUser ? 'recovery' : 'invite');
    const inviteLink = buildPasswordSetupLink(inviteActionUrl, reusedExistingUser ? 'recovery' : 'invite');


    // Assign role (trigger may have already created a 'user' row)
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .upsert(
        { user_id: userId, role, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );

    if (roleError) throw roleError;

    // Send invite email via Resend from hello@shipscoper.com
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? 'Shipscoper <hello@shipscoper.com>',
        to: email,
        subject: 'Einladung zu Shipscoper',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
            <h2 style="font-size:20px;font-weight:700;margin-bottom:8px;">Du wurdest zu Shipscoper eingeladen</h2>
            <p style="color:#6b7280;font-size:14px;margin-bottom:24px;">
              Klicke auf den Button unten, um dein Passwort festzulegen und deinen Account zu aktivieren.
            </p>
            <a href="${inviteLink}"
               style="display:inline-block;background:#0f172a;color:#fff;font-size:14px;font-weight:600;
                      padding:12px 24px;border-radius:8px;text-decoration:none;">
              Passwort festlegen
            </a>
            <p style="color:#9ca3af;font-size:12px;margin-top:32px;">
              Falls du diesen Link nicht angefordert hast, kannst du diese E-Mail ignorieren.<br/>
              Der Link ist 24 Stunden gültig.
            </p>
          </div>
        `,
      }),
    });

    if (!process.env.RESEND_API_KEY || !resendRes.ok) {
      const resendErr = await resendRes.text();
      console.error('Resend error:', resendErr);
      throw new Error('E-Mail konnte nicht gesendet werden');
    }

    return NextResponse.json({
      success: true,
      user: { id: userId, email, role },
      reusedExistingUser,
    });
  } catch (error) {
    console.error('Error creating user:', error);
    const mapped = mapCreateUserError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

// PATCH: Update user role
export async function PATCH(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { userId, role } = updateRoleSchema.parse(body);

    // Prevent demoting yourself
    if (userId === session.user.id && role !== 'admin') {
      return NextResponse.json(
        { error: 'Cannot remove your own admin role' },
        { status: 400 }
      );
    }

    const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
    const supabaseAdmin = getSupabaseAdmin();

    const { error } = await supabaseAdmin
      .from('user_roles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating role:', error);
    const mapped = mapCreateUserError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

// DELETE: Delete user
export async function DELETE(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 }
      );
    }

    if (userId === session.user.id) {
      return NextResponse.json(
        { error: 'Cannot delete your own account' },
        { status: 400 }
      );
    }

    const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
    const supabaseAdmin = getSupabaseAdmin();

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    const mapped = mapCreateUserError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
