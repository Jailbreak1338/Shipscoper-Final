import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readdir, unlink, stat } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { detectColumns, processExcel, ColumnMapping } from '@/lib/excel';
import { getClientIp, extractShipmentNumbers } from '@/lib/security';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import * as XLSX from 'xlsx';

const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || '10', 10);
const TMP_TTL_MIN = parseInt(process.env.TMP_TTL_MIN || '30', 10);

function getTmpDir(): string {
  return '/tmp';
}

async function cleanupTmp(): Promise<void> {
  const tmpDir = getTmpDir();
  try {
    const files = await readdir(tmpDir);
    const now = Date.now();
    const ttlMs = TMP_TTL_MIN * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(tmpDir, file);
      try {
        const stats = await stat(filePath);
        if (now - stats.mtimeMs > ttlMs) {
          await unlink(filePath);
        }
      } catch {
        // ignore individual file errors
      }
    }
  } catch {
    // tmp dir might not exist yet
  }
}

async function logUpload(params: {
  userId: string;
  filename: string;
  fileSize: number;
  matchedCount: number;
  unmatchedCount: number;
  totalRows: number;
  shipmentNumbers: string[];
  processingTimeMs: number;
  ipAddress: string;
  userAgent: string;
}): Promise<void> {
  try {
    const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
    const supabase = getSupabaseAdmin();

    const { error } = await supabase.from('upload_logs').insert({
      user_id: params.userId,
      filename: params.filename,
      file_size_bytes: params.fileSize,
      matched_count: params.matchedCount,
      unmatched_count: params.unmatchedCount,
      total_rows: params.totalRows,
      shipment_numbers: params.shipmentNumbers,
      processing_time_ms: params.processingTimeMs,
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
    });

    if (error) {
      console.error('Failed to log upload:', error);
    }
  } catch (err) {
    console.error('Failed to log upload:', err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();

  // Get authenticated user
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ipAddress = getClientIp(request.headers);
  const userAgent = request.headers.get('user-agent') || 'unknown';

  try {
    // Run cleanup in background (fire-and-forget)
    cleanupTmp().catch(() => {});

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Content-Type must be multipart/form-data' },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file uploaded. Please select an Excel file (.xlsx or .xls).' },
        { status: 400 }
      );
    }

    // Check file size
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_MB} MB.` },
        { status: 400 }
      );
    }

    // Check file extension
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an .xlsx or .xls file.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // If mode=detect, just return detected columns (no logging needed)
    const mode = formData.get('mode') as string | null;
    if (mode === 'detect') {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
        defval: '',
      });
      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      const detected = detectColumns(headers);

      return NextResponse.json({ detected });
    }

    // Get column mappings from form data
    const vesselCol = formData.get('vesselCol') as string | null;
    const etaCols = formData.getAll('etaCols').map(String).filter(Boolean);
    const terminalCol = (formData.get('terminalCol') as string | null) || undefined;

    if (!vesselCol || etaCols.length === 0) {
      return NextResponse.json(
        {
          error:
            'Missing column mapping. Please specify vesselCol and at least one ETA column.',
        },
        { status: 400 }
      );
    }

    const columns: ColumnMapping = {
      vesselCol,
      etaCols,
      terminalCol: terminalCol || undefined,
    };

    // Process Excel
    const { updatedBuffer, result } = await processExcel(fileBuffer, columns);

    // Extract S00... shipment numbers from original Excel
    const shipmentNumbers: string[] = [];
    const scanWorkbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: false });
    const scanSheet = scanWorkbook.Sheets[scanWorkbook.SheetNames[0]];
    const scanRef = scanSheet['!ref'];
    if (scanRef) {
      const range = XLSX.utils.decode_range(scanRef);
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r, c });
          const cell = scanSheet[cellAddr];
          if (cell && cell.v != null) {
            const nums = extractShipmentNumbers(String(cell.v));
            shipmentNumbers.push(...nums);
          }
        }
      }
    }
    const uniqueShipments = [...new Set(shipmentNumbers)];

    // Save to tmp (/tmp is writable on Vercel)
    const jobId = crypto.randomUUID();
    const tmpPath = path.join(getTmpDir(), `${jobId}.xlsx`);
    await writeFile(tmpPath, updatedBuffer);

    // Log upload activity
    const processingTimeMs = Date.now() - startTime;
    try {
      await logUpload({
        userId: session.user.id,
        filename: file.name,
        fileSize: file.size,
        matchedCount: result.matched,
        unmatchedCount: result.unmatched,
        totalRows: result.totalRows,
        shipmentNumbers: uniqueShipments,
        processingTimeMs,
        ipAddress,
        userAgent,
      });
    } catch (logErr) {
      console.error('logUpload failed:', logErr);
    }

    return NextResponse.json({
      jobId,
      summary: {
        totalRows: result.totalRows,
        matched: result.matched,
        unmatched: result.unmatched,
        skippedOld: result.skippedOld,
        unmatchedNames: result.unmatchedNames,
      },
    });
  } catch (error) {
    console.error('update-excel error:', error);

    const message =
      error instanceof Error ? error.message : 'Internal server error';

    if (message.includes('Supabase')) {
      return NextResponse.json(
        {
          error:
            'Database connection error. Please check your Supabase configuration and try again.',
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
