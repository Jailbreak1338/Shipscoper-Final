import { NextRequest, NextResponse } from 'next/server';
import { readFile, access } from 'fs/promises';
import path from 'path';

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
): Promise<NextResponse> {
  const { jobId } = params;

  // Validate jobId format (UUID only, prevent path traversal)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(jobId)) {
    return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
  }

  const tmpDir = path.join(process.cwd(), 'tmp');
  const filePath = path.join(tmpDir, `${jobId}.xlsx`);

  try {
    await access(filePath);
  } catch {
    return NextResponse.json(
      {
        error:
          'File not found or expired. Files are automatically deleted after 30 minutes. Please re-upload your Excel file.',
      },
      { status: 404 }
    );
  }

  try {
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
