'use server';

import { getSupabaseAdmin } from '@/lib/supabaseServer';
import { sendResendEmail, buildWaitlistEmail } from '@/lib/resend';

export async function joinWaitlist(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const email = formData.get('email')?.toString().trim() ?? '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: 'Ungültige E-Mail-Adresse.' };
  }

  const admin = getSupabaseAdmin();

  const { error } = await admin
    .from('waitlist')
    .upsert({ email }, { onConflict: 'email' });

  if (error) {
    console.error('[waitlist] Supabase error:', error.message);
    return { success: false, error: 'Fehler beim Speichern. Bitte erneut versuchen.' };
  }

  try {
    await sendResendEmail({
      to: email,
      subject: 'Du bist auf der Shipscoper-Warteliste',
      html: buildWaitlistEmail(),
    });
  } catch (err) {
    console.error('[waitlist] Email error:', err);
  }

  return { success: true };
}
