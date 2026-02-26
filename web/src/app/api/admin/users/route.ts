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

    // Generate invite link without auto-sending (so we can send via Resend)
    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: 'invite',
        email,
      });

    if (linkError) throw linkError;

    // Assign role (trigger may have already created a 'user' row)
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .upsert(
        { user_id: linkData.user.id, role, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );

    if (roleError) throw roleError;

    // Send invite email via Resend from hello@shipscoper.com
    const inviteUrl = linkData.properties.action_link;
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
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
            <a href="${inviteUrl}"
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

    if (!resendRes.ok) {
      const resendErr = await resendRes.text();
      console.error('Resend error:', resendErr);
      throw new Error('E-Mail konnte nicht gesendet werden');
    }

    return NextResponse.json({
      success: true,
      user: { id: linkData.user.id, email: linkData.user.email, role },
    });
  } catch (error) {
    console.error('Error creating user:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
