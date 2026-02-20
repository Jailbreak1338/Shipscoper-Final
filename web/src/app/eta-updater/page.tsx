'use client';

import { useState, useRef, type ChangeEvent, type CSSProperties } from 'react';

interface DetectedColumns {
  shipmentCol: string | null;
  vesselCol: string | null;
  etaCol: string | null;
  etaCols: string[];
  customsCol: string | null;
  allColumns: string[];
}

interface UpdateSummary {
  totalRows: number;
  matched: number;
  unmatched: number;
  skippedOld: number;
  skippedCustoms: number;
  unmatchedNames: string[];
  unmatchedRows: Array<{
    shipmentRef: string | null;
    vesselName: string;
    eta: string | null;
  }>;
  etaChanges: Array<{
    shipmentRef: string | null;
    vesselName: string;
    oldEta: string | null;
    newEta: string | null;
  }>;
}

type Step = 'upload' | 'columns' | 'processing' | 'result';

export default function EtaUpdaterPage() {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [detected, setDetected] = useState<DetectedColumns | null>(null);
  const [shipmentCol, setShipmentCol] = useState('');
  const [vesselCol, setVesselCol] = useState('');
  const [etaCol, setEtaCol] = useState('');
  const [customsCol, setCustomsCol] = useState('');
  const [summary, setSummary] = useState<UpdateSummary | null>(null);
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const groupedUnmatched = (() => {
    if (!summary) return [];
    const validRows = summary.unmatchedRows.filter((row) => {
      const vessel = (row.vesselName || '').trim();
      const snr = (row.shipmentRef || '').trim();
      return vessel && vessel !== '(empty)' && (snr || row.eta);
    });

    const map = new Map<
      string,
      Array<{ shipmentRef: string | null; eta: string | null }>
    >();

    for (const row of validRows) {
      const vessel = row.vesselName.trim();
      const existing = map.get(vessel) ?? [];
      existing.push({ shipmentRef: row.shipmentRef, eta: row.eta });
      map.set(vessel, existing);
    }

    return Array.from(map.entries()).map(([vesselName, rows]) => ({
      vesselName,
      rows,
    }));
  })();

  async function handleFileSelect(selectedFile: File) {
    setError('');
    setFile(selectedFile);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('mode', 'detect');

      const res = await fetch('/api/update-excel', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to read file');
        setLoading(false);
        return;
      }

      const det: DetectedColumns = data.detected;
      setDetected(det);
      setShipmentCol(det.shipmentCol || '');
      setVesselCol(det.vesselCol || '');
      setEtaCol(det.etaCol || det.etaCols[0] || '');
      setCustomsCol(det.customsCol || '');
      setStep('columns');
    } catch {
      setError('Failed to upload file. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFileSelect(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
  }

  async function handleUpdate() {
    if (!file || !vesselCol || !etaCol) {
      setError('Bitte Vessel-Spalte und ETA-Spalte auswählen.');
      return;
    }

    setError('');
    setLoading(true);
    setStep('processing');

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (shipmentCol) {
        formData.append('shipmentCol', shipmentCol);
      }
      formData.append('vesselCol', vesselCol);
      formData.append('etaCols', etaCol);
      if (customsCol) {
        formData.append('customsCol', customsCol);
      }

      const res = await fetch('/api/update-excel', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Update failed');
        setStep('columns');
        return;
      }

      setSummary(data.summary);
      setJobId(data.jobId);
      setStep('result');
    } catch {
      setError('Network error. Please try again.');
      setStep('columns');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep('upload');
    setFile(null);
    setDetected(null);
    setShipmentCol('');
    setVesselCol('');
    setEtaCol('');
    setCustomsCol('');
    setSummary(null);
    setJobId('');
    setError('');
    setLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Vessel ETA Updater</h1>
        <p style={styles.subtitle}>
          Excel hochladen, ETAs automatisch aus der Datenbank aktualisieren.
        </p>

        <div style={styles.steps}>
          {(['upload', 'columns', 'result'] as const).map((s, i) => {
            const labels = ['Upload', 'Spalten', 'Ergebnis'];
            const isActive =
              s === step || (step === 'processing' && s === 'result');
            const isDone =
              (s === 'upload' && step !== 'upload') ||
              (s === 'columns' &&
                (step === 'processing' || step === 'result'));
            return (
              <div key={s} style={styles.stepItem}>
                <div
                  style={{
                    ...styles.stepCircle,
                    backgroundColor: isDone
                      ? '#22c55e'
                      : isActive
                        ? '#0066cc'
                        : '#ddd',
                    color: isDone || isActive ? '#fff' : '#999',
                  }}
                >
                  {isDone ? '\u2713' : i + 1}
                </div>
                <span
                  style={{
                    fontSize: '13px',
                    color: isActive ? '#0066cc' : '#666',
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {labels[i]}
                </span>
              </div>
            );
          })}
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {step === 'upload' && (
          <div
            style={{
              ...styles.dropzone,
              borderColor: dragOver ? '#0066cc' : '#ccc',
              backgroundColor: dragOver ? '#f0f7ff' : '#fafafa',
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={onFileChange}
              style={{ display: 'none' }}
            />
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>
              {loading ? '\u23F3' : '\uD83D\uDCC4'}
            </div>
            <p style={{ margin: '0 0 8px', fontWeight: 600 }}>
              {loading
                ? 'Datei wird analysiert...'
                : 'Excel-Datei hier ablegen'}
            </p>
            <p style={{ margin: 0, fontSize: '14px', color: '#888' }}>
              oder klicken zum Auswaehlen (.xlsx / .xls, max 10 MB)
            </p>
          </div>
        )}

        {step === 'columns' && detected && (
          <div style={styles.section}>
            <p style={{ margin: '0 0 4px', fontSize: '14px', color: '#666' }}>
              Datei: <strong>{file?.name}</strong>
            </p>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#888' }}>
              Spalten automatisch erkannt. Bei Bedarf anpassen.
            </p>

            <div style={styles.formGroup}>
              <label style={styles.label}>Sendungsnummer Spalte</label>
              <select
                style={styles.select}
                value={shipmentCol}
                onChange={(e) => setShipmentCol(e.target.value)}
              >
                <option value="">-- Keine --</option>
                {detected.allColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                Vessel Name Spalte <span style={{ color: '#e00' }}>*</span>
              </label>
              <select
                style={styles.select}
                value={vesselCol}
                onChange={(e) => setVesselCol(e.target.value)}
              >
                <option value="">-- Spalte waehlen --</option>
                {detected.allColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                ETA Spalte <span style={{ color: '#e00' }}>*</span>
              </label>
              <select
                style={styles.select}
                value={etaCol}
                onChange={(e) => setEtaCol(e.target.value)}
              >
                <option value="">-- Spalte waehlen --</option>
                {detected.allColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Verzollt Spalte (optional)</label>
              <select
                style={styles.select}
                value={customsCol}
                onChange={(e) => setCustomsCol(e.target.value)}
              >
                <option value="">-- Keine --</option>
                {detected.allColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#777' }}>
                Wenn die Zelle in dieser Spalte gefuellt ist, wird die Zeile
                als uebersprungen markiert.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button style={styles.btnSecondary} onClick={reset}>
                Zurueck
              </button>
              <button
                style={{
                  ...styles.btnPrimary,
                  opacity: !vesselCol || !etaCol ? 0.5 : 1,
                }}
                disabled={!vesselCol || !etaCol || loading}
                onClick={handleUpdate}
              >
                ETAs updaten
              </button>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div style={{ textAlign: 'center' as const, padding: '48px 0' }}>
            <div style={styles.spinner} />
            <p style={{ marginTop: '16px', color: '#666' }}>
              ETAs werden abgeglichen...
            </p>
          </div>
        )}

        {step === 'result' && summary && (
          <div style={styles.section}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>Ergebnis</h2>

            <div style={styles.statsGrid}>
              <div style={styles.statCard}>
                <div style={{ fontSize: '28px', fontWeight: 700 }}>
                  {summary.totalRows}
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  Zeilen gesamt
                </div>
              </div>
              <div style={{ ...styles.statCard, borderColor: '#22c55e' }}>
                <div
                  style={{
                    fontSize: '28px',
                    fontWeight: 700,
                    color: '#22c55e',
                  }}
                >
                  {summary.matched}
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  Matched
                </div>
              </div>
              <div
                style={{
                  ...styles.statCard,
                  borderColor:
                    summary.unmatched > 0 ? '#f59e0b' : '#22c55e',
                }}
              >
                <div
                  style={{
                    fontSize: '28px',
                    fontWeight: 700,
                    color: summary.unmatched > 0 ? '#f59e0b' : '#22c55e',
                  }}
                >
                  {summary.unmatched}
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  Unmatched
                </div>
              </div>
              <div style={{ ...styles.statCard, borderColor: '#94a3b8' }}>
                <div
                  style={{
                    fontSize: '28px',
                    fontWeight: 700,
                    color: '#94a3b8',
                  }}
                >
                  {summary.skippedOld}
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  Uebersprungen (alt)
                </div>
              </div>
              <div style={{ ...styles.statCard, borderColor: '#64748b' }}>
                <div
                  style={{
                    fontSize: '28px',
                    fontWeight: 700,
                    color: '#64748b',
                  }}
                >
                  {summary.skippedCustoms}
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  Uebersprungen (verzollt)
                </div>
              </div>
            </div>

            {groupedUnmatched.length > 0 && (
              <div style={styles.unmatchedBox}>
                <strong style={{ display: 'block', marginBottom: '8px' }}>
                  Nicht gefundene Eintraege (max. 20):
                </strong>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {groupedUnmatched.map((group, i) => (
                    <div key={`${group.vesselName}-${i}`} style={{ fontSize: '14px' }}>
                      <div style={{ fontWeight: 600 }}>Schiff: {group.vesselName}</div>
                      <ul style={{ margin: '4px 0 0', paddingLeft: '20px' }}>
                        {group.rows.map((row, j) => (
                          <li key={`${group.vesselName}-${j}`} style={{ marginBottom: '3px' }}>
                            S-Nr: {row.shipmentRef || '-'} | ETA: {row.eta || '-'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.etaChanges.length > 0 && (
              <div style={{ ...styles.unmatchedBox, marginTop: '12px' }}>
                <strong style={{ display: 'block', marginBottom: '8px' }}>
                  ETA-Aenderungen (max. 50):
                </strong>
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                  {summary.etaChanges.map((chg, i) => (
                    <li key={i} style={{ fontSize: '14px', marginBottom: '4px' }}>
                      S-Nr: {chg.shipmentRef || '-'} | Schiff: {chg.vesselName} | {chg.oldEta || '-'} -&gt; {chg.newEta || '-'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                gap: '12px',
                marginTop: '24px',
                flexWrap: 'wrap' as const,
              }}
            >
              <a
                href={`/api/download/${jobId}`}
                style={{
                  ...styles.btnPrimary,
                  textDecoration: 'none',
                  textAlign: 'center' as const,
                }}
                download
              >
                Excel herunterladen
              </a>
              <button style={styles.btnSecondary} onClick={reset}>
                Neue Datei hochladen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    maxWidth: '640px',
    margin: '0 auto',
    padding: '24px 16px',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '32px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)',
  },
  title: {
    margin: '0 0 4px',
    fontSize: '24px',
    fontWeight: 700,
  },
  subtitle: {
    margin: '0 0 24px',
    fontSize: '15px',
    color: '#666',
  },
  steps: {
    display: 'flex',
    justifyContent: 'center',
    gap: '32px',
    marginBottom: '28px',
    paddingBottom: '20px',
    borderBottom: '1px solid #eee',
  },
  stepItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
  },
  stepCircle: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 600,
  },
  dropzone: {
    border: '2px dashed #ccc',
    borderRadius: '12px',
    padding: '48px 24px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background-color 0.2s',
  },
  section: {},
  formGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '14px',
    fontWeight: 600,
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    backgroundColor: '#fff',
    appearance: 'auto' as CSSProperties['appearance'],
  },
  btnPrimary: {
    display: 'inline-block',
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: 600,
    color: '#fff',
    backgroundColor: '#0066cc',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    flex: 1,
  },
  btnSecondary: {
    display: 'inline-block',
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: 600,
    color: '#333',
    backgroundColor: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  error: {
    padding: '12px 16px',
    marginBottom: '16px',
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    borderRadius: '8px',
    fontSize: '14px',
    border: '1px solid #fecaca',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '12px',
    marginBottom: '20px',
  },
  statCard: {
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    textAlign: 'center',
  },
  unmatchedBox: {
    padding: '16px',
    backgroundColor: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: '8px',
    fontSize: '14px',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e5e7eb',
    borderTopColor: '#0066cc',
    borderRadius: '50%',
    margin: '0 auto',
    animation: 'spin 0.8s linear infinite',
  },
};
