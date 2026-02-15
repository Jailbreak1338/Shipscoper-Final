import { z } from 'zod';

// File upload validation schema
export const fileUploadSchema = z.object({
  name: z
    .string()
    .min(1, 'Filename required')
    .max(255, 'Filename too long')
    .regex(/^[\w\-. ]+\.(xlsx|xls)$/i, 'Invalid filename'),
  size: z
    .number()
    .max(10 * 1024 * 1024, 'File too large (max 10MB)'),
  type: z.enum(
    [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    { errorMap: () => ({ message: 'Invalid file type' }) }
  ),
});

// Sanitize user input (prevent XSS)
export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[<>"']/g, '')
    .slice(0, 1000);
}

// Validate vessel name (prevent SQL injection patterns)
export function isValidVesselName(name: string): boolean {
  const sqlInjectionPattern =
    /(\b(DROP|DELETE|INSERT|UPDATE|SELECT|UNION|EXEC|SCRIPT|ALTER|CREATE)\b|[;<>])/gi;
  if (sqlInjectionPattern.test(name)) {
    return false;
  }
  if (name.length > 200) {
    return false;
  }
  return true;
}

// Generate secure filename (prevent path traversal)
export function generateSecureFilename(originalName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);

  const ext = originalName.split('.').pop()?.toLowerCase() || 'xlsx';

  const baseName = originalName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 50);

  return `${timestamp}_${random}_${baseName}.${ext}`;
}

// Extract client IP (for logging/rate limiting)
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const real = headers.get('x-real-ip');

  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  return real || 'unknown';
}

// Extract S00... shipment numbers from text
export function extractShipmentNumbers(text: string): string[] {
  const pattern = /S\d{8}/gi;
  const matches = text.match(pattern) || [];
  return [...new Set(matches.map((s) => s.toUpperCase()))];
}
