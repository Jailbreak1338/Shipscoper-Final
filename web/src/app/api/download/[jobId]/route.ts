import { NextRequest, NextResponse } from 'next/server';
import { readFile, access, unlink } from 'fs/promises';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getTmpFilePath, getTmpMetaPath, isTmpFileExpired, TMP_TTL_MIN } from '@/lib/tmpFiles';

const EXPIRED_MSG = `File not found or expired. Files are automatically deleted after ${TMP_TTL_MIN} minutes. Please re-upload your Excel file.`;

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
): Promise<NextResponse> {
  // Authentication check (middleware already guards /api/download, but be explicit)
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId } = params;

  // Validate jobId format (UUID only, prevent path traversal)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(jobId)) {
    return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
  }

  const filePath = getTmpFilePath(jobId);
  const metaPath = getTmpMetaPath(jobId);

  // Verify file exists
  try {
    await access(filePath);
  } catch {
    return NextResponse.json({ error: EXPIRED_MSG }, { status: 404 });
  }

  // Ownership check — prevent IDOR (user A cannot download user B's file)
  try {
    const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
    if (!meta?.userId || meta.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } catch {
    // Meta missing (legacy file or race) → treat as not found
    return NextResponse.json({ error: EXPIRED_MSG }, { status: 404 });
  }

  try {
    if (await isTmpFileExpired(filePath)) {
      try {
        await unlink(filePath);
        await unlink(metaPath).catch(() => {});
      } catch {
        // Ignore race if file was already deleted.
      }
      return NextResponse.json({ error: EXPIRED_MSG }, { status: 404 });
    }

    const fileBuffer = await readFile(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="eta_updated_${jobId.slice(0, 8)}.xlsx"`,
        'Content-Length': String(fileBuffer.length),
      },
    });
  } catch (error) {
    console.error('download error:', error);
    return NextResponse.json(
      { error: 'Failed to read file' },
      { status: 500 }
    );
  }
}
