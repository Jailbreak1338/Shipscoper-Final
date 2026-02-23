import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import crypto from 'crypto';
import { detectColumns, processExcel, ColumnMapping } from '@/lib/excel';
import { normalizeVesselName } from '@/lib/normalize';
import { getClientIp, extractShipmentNumbers } from '@/lib/security';
import { cleanupExpiredTmpFiles, getTmpFilePath, TMP_TTL_MIN } from '@/lib/tmpFiles';
import { revalidatePath } from 'next/cache';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import * as XLSX from 'xlsx';

const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || '10', 10);


function parseShipmentRefs(input: string | null | undefined): string[] {
  return String(input ?? '')
    .split(/[;,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function autoAssignShipmentsFromUpload(params: {
  userId: string;
  fileBuffer: Buffer;
  vesselCol: string;
  shipmentCol: string;
  containerCol?: string;
}): Promise<{ updatedCount: number; skippedConflicts: number }> {
  const workbook = XLSX.read(params.fileBuffer, { type: 'buffer' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

  const CONTAINER_RE = /^[A-Z]{4}[0-9]{7}$/;
  const assignmentByVessel = new Map<string, {
    vesselName: string;
    refs: Set<string>;
    containers: Set<string>;
    pairs: Array<{ container_no: string; snr: string | null }>;
  }>();
  for (const row of rows) {
    const vesselRaw = String(row[params.vesselCol] ?? '').trim();
    if (!vesselRaw) continue;

    const refs = extractShipmentNumbers(String(row[params.shipmentCol] ?? ''));
    if (refs.length === 0) continue;

    const normalized = normalizeVesselName(vesselRaw);
    const existing = assignmentByVessel.get(normalized) ?? {
      vesselName: vesselRaw,
      refs: new Set<string>(),
      containers: new Set<string>(),
      pairs: [] as Array<{ container_no: string; snr: string | null }>,
    };

    for (const ref of refs) {
      existing.refs.add(ref);
    }

    if (params.containerCol) {
      const containerRaw = String(row[params.containerCol] ?? '').trim().toUpperCase();
      if (containerRaw && CONTAINER_RE.test(containerRaw)) {
        existing.containers.add(containerRaw);
        // Build exact container↔S-Nr pair (one per row, first S-Nr wins if duplicate container)
        if (!existing.pairs.some((p) => p.container_no === containerRaw)) {
          existing.pairs.push({ container_no: containerRaw, snr: refs[0] ?? null });
        }
      }
    }

    assignmentByVessel.set(normalized, existing);
  }

  if (assignmentByVessel.size === 0) {
    return { updatedCount: 0, skippedConflicts: 0 };
  }

  const { getSupabaseAdmin } = await import('@/lib/supabaseServer');
  const admin = getSupabaseAdmin();

  const { data: existingRows, error: existingError } = await admin
    .from('vessel_watches')
    .select('id, vessel_name_normalized, shipment_reference, container_reference')
    .eq('user_id', params.userId);

  if (existingError) {
    console.error('autoAssignShipmentsFromUpload: failed to fetch existing rows', existingError);
    return { updatedCount: 0, skippedConflicts: 0 };
  }

  const existingByVessel = new Map<string, { id: string; refs: Set<string>; containers: Set<string> }>();
  const ownerByShipmentRef = new Map<string, string>();
  for (const row of existingRows ?? []) {
    const key = String(row.vessel_name_normalized);
    const refs = new Set(parseShipmentRefs(row.shipment_reference));
    const containers = new Set(parseShipmentRefs(row.container_reference));
    if (assignmentByVessel.has(key) && !existingByVessel.has(key)) {
      existingByVessel.set(key, { id: String(row.id), refs, containers });
    }
    for (const ref of refs) {
      ownerByShipmentRef.set(ref, key);
    }
  }

  let updatedCount = 0;
  let skippedConflicts = 0;

  const fileOwnerByRef = new Map<string, string>();
  for (const [normalized, payload] of assignmentByVessel.entries()) {
    for (const ref of payload.refs) {
      const prev = fileOwnerByRef.get(ref);
      if (prev && prev !== normalized) {
        payload.refs.delete(ref);
        skippedConflicts += 1;
      } else {
        fileOwnerByRef.set(ref, normalized);
      }
    }
  }

  const inserts: Array<{
    user_id: string;
    vessel_name: string;
    vessel_name_normalized: string;
    shipment_reference: string;
    container_reference: string | null;
    container_snr_pairs: unknown | null;
    last_known_eta: string | null;
    notification_enabled: boolean;
  }> = [];

  for (const [normalized, payload] of assignmentByVessel.entries()) {
    const refs = Array.from(payload.refs).filter((ref) => {
      const owner = ownerByShipmentRef.get(ref);
      if (!owner || owner === normalized) return true;
      skippedConflicts += 1;
      return false;
    });
    if (refs.length === 0) continue;

    const containerRef = payload.containers.size > 0
      ? Array.from(payload.containers).join(', ')
      : null;

    const existing = existingByVessel.get(normalized);

    if (!existing) {
      inserts.push({
        user_id: params.userId,
        vessel_name: payload.vesselName,
        vessel_name_normalized: normalized,
        shipment_reference: refs.join(', '),
        container_reference: containerRef,
        container_snr_pairs: payload.pairs.length > 0 ? payload.pairs : null,
        last_known_eta: null, // filled in batch below
        notification_enabled: false,
      });
      continue;
    }

    const mergedRefs = new Set(existing.refs);
    for (const ref of refs) mergedRefs.add(ref);
    const mergedContainers = new Set(existing.containers);
    if (containerRef) {
      for (const c of payload.containers) mergedContainers.add(c);
    }

    const refsChanged = mergedRefs.size !== existing.refs.size;
    const containersChanged = mergedContainers.size !== existing.containers.size;
    const pairsChanged = payload.pairs.length > 0;
    if (!refsChanged && !containersChanged && !pairsChanged) continue;

    const updatePayload: Record<string, unknown> = {};
    if (refsChanged) updatePayload.shipment_reference = Array.from(mergedRefs).join(', ');
    if (containersChanged) updatePayload.container_reference = Array.from(mergedContainers).join(', ');
    if (pairsChanged) updatePayload.container_snr_pairs = payload.pairs;

    const { error: updateError } = await admin
      .from('vessel_watches')
      .update(updatePayload)
      .eq('id', existing.id);

    if (!updateError) {
      updatedCount += 1;
    } else {
      console.error('autoAssignShipmentsFromUpload: failed to update watch', updateError);
    }
  }

  if (inserts.length > 0) {
    // Batch-lookup current ETAs from latest_schedule for all new entries
    const normalizedNames = inserts.map((ins) => ins.vessel_name_normalized);
    const { data: schedules } = await admin
      .from('latest_schedule')
      .select('name_normalized, eta')
      .in('name_normalized', normalizedNames);
    const etaMap = new Map((schedules ?? []).map((s) => [s.name_normalized as string, s.eta as string | null]));
    for (const ins of inserts) {
      ins.last_known_eta = etaMap.get(ins.vessel_name_normalized) ?? null;
    }

    const { error: insertError } = await admin
      .from('vessel_watches')
      .insert(inserts);

    if (insertError) {
      console.error('autoAssignShipmentsFromUpload: failed to insert watches', insertError);
    } else {
      updatedCount += inserts.length;
    }
  }

  return { updatedCount, skippedConflicts };
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
    const shipmentCol = (formData.get('shipmentCol') as string | null) || undefined;
    const vesselCol = formData.get('vesselCol') as string | null;
    const etaCols = formData.getAll('etaCols').map(String).filter(Boolean);
    const terminalCol = (formData.get('terminalCol') as string | null) || undefined;
    const customsCol = (formData.get('customsCol') as string | null) || undefined;
    const containerCol = (formData.get('containerCol') as string | null) || undefined;

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
      shipmentCol: shipmentCol || undefined,
      vesselCol,
      etaCols,
      terminalCol: terminalCol || undefined,
      customsCol: customsCol || undefined,
    };

    // Process Excel
    const { updatedBuffer, result } = await processExcel(fileBuffer, columns);

    // Extract S00... shipment numbers from original Excel.
    // If shipmentCol is selected, prioritize that column for cleaner logs.
    const shipmentNumbers: string[] = [];
    const scanWorkbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: false });
    const scanSheet = scanWorkbook.Sheets[scanWorkbook.SheetNames[0]];
    const scanRef = scanSheet['!ref'];
    if (scanRef) {
      const range = XLSX.utils.decode_range(scanRef);

      // Build header map from row 0
      const headerToCol = new Map<string, number>();
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r: range.s.r, c });
        const cell = scanSheet[cellAddr];
        const header = cell?.v != null ? String(cell.v).trim() : '';
        if (header) {
          headerToCol.set(header, c);
        }
      }

      const scanOnlyCol = shipmentCol ? headerToCol.get(shipmentCol) : undefined;

      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        if (scanOnlyCol !== undefined) {
          const cellAddr = XLSX.utils.encode_cell({ r, c: scanOnlyCol });
          const cell = scanSheet[cellAddr];
          if (cell?.v != null) {
            shipmentNumbers.push(...extractShipmentNumbers(String(cell.v)));
          }
          continue;
        }

        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r, c });
          const cell = scanSheet[cellAddr];
          if (cell?.v != null) {
            shipmentNumbers.push(...extractShipmentNumbers(String(cell.v)));
          }
        }
      }
    }
    const uniqueShipments = [...new Set(shipmentNumbers)];

    // Cleanup stale temp files before writing the new artifact.
    await cleanupExpiredTmpFiles();

    // Save to /tmp (the writable directory on Vercel Lambda)
    const jobId = crypto.randomUUID();
    const tmpPath = getTmpFilePath(jobId);
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
    let autoAssignedCount = 0;
    let autoAssignSkippedConflicts = 0;
    if (shipmentCol) {
      const assignResult = await autoAssignShipmentsFromUpload({
        userId: session.user.id,
        fileBuffer,
        vesselCol,
        shipmentCol,
        containerCol,
      });
      autoAssignedCount = assignResult.updatedCount;
      autoAssignSkippedConflicts = assignResult.skippedConflicts;
    }

    revalidatePath('/dashboard');
    revalidatePath('/schedule-search');
    revalidatePath('/watchlist');

    return NextResponse.json({
      jobId,
      summary: {
        totalRows: result.totalRows,
        matched: result.matched,
        unmatched: result.unmatched,
        skippedOld: result.skippedOld,
        skippedCustoms: result.skippedCustoms,
        unmatchedNames: result.unmatchedNames,
        unmatchedRows: result.unmatchedRows,
        etaChanges: result.etaChanges,
        autoAssignedShipments: autoAssignedCount,
        autoAssignSkippedConflicts,
      },
      file_ttl_minutes: TMP_TTL_MIN,
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
