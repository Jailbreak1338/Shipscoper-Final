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
  autoAssignedShipments?: number;
<<<<<<< codex/review-handover-file-for-testing-suggestions-ipr7vu
  autoAssignSkippedConflicts?: number;
=======
>>>>>>> main
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

  const unmatchedVessels = (() => {
    if (!summary) return [];
    return Array.from(
      new Set(
        summary.unmatchedNames
          .map((name) => name.trim())
          .filter((name) => name && name !== '(empty)')
      )
    );
  })();

  const groupedEtaChanges = (() => {
    if (!summary) return [];

    const parseGermanDate = (value: string | null): number | null => {
      if (!value) return null;
      const m = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!m) return null;
      const [, dd, mm, yyyy] = m;
      return new Date(Number(yyyy), Number(mm) - 1, Number(dd)).getTime();
    };

    const byVessel = new Map<
      string,
      {
        oldEta: string | null;
        newEta: string | null;
        dayDiff: number | null;
        shipmentRefs: string[];
      }
    >();

    for (const change of summary.etaChanges) {
      const vessel = change.vesselName.trim() || 'Unbekanntes Schiff';
      const existing = byVessel.get(vessel);
      const shipmentRef = (change.shipmentRef || '').trim();

      const oldTs = parseGermanDate(change.oldEta);
      const newTs = parseGermanDate(change.newEta);
      const dayDiff =
        oldTs != null && newTs != null
          ? Math.round((newTs - oldTs) / 86_400_000)
          : null;

      if (!existing) {
        byVessel.set(vessel, {
          oldEta: change.oldEta,
          newEta: change.newEta,
          dayDiff,
          shipmentRefs: shipmentRef ? [shipmentRef] : [],
        });
        continue;
      }

      if (shipmentRef && !existing.shipmentRefs.includes(shipmentRef)) {
        existing.shipmentRefs.push(shipmentRef);
      }
    }

    return Array.from(byVessel.entries()).map(([vesselName, data]) => ({
      vesselName,
      ...data,
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
                        : 'var(--surface-muted)',
                    color: isDone || isActive ? '#fff' : 'var(--text-secondary)',
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
              backgroundColor: dragOver ? 'rgba(14,165,233,0.12)' : 'var(--surface-muted)',
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
<<<<<<< codex/review-handover-file-for-testing-suggestions-ipr7vu
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
=======
            <p style={{ margin: 0, fontSize: '14px', color: '#888' }}>
>>>>>>> main
              oder klicken zum Auswählen (.xlsx / .xls, max 10 MB)
            </p>
          </div>
        )}

        {step === 'columns' && detected && (
          <div style={styles.section}>
            <p style={{ margin: '0 0 4px', fontSize: '14px', color: 'var(--text-secondary)' }}>
              Datei: <strong>{file?.name}</strong>
            </p>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
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
                <option value="">-- Spalte wählen --</option>
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
                <option value="">-- Spalte wählen --</option>
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
                Wenn die Zelle in dieser Spalte gefüllt ist, wird die Zeile
                als übersprungen markiert.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button style={styles.btnSecondary} onClick={reset}>
                Zurück
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
            <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>
              ETAs werden abgeglichen...
            </p>
          </div>
        )}

        {step === 'result' && summary && (
          <div style={styles.section}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>Ergebnis</h2>

            {unmatchedVessels.length > 0 && (
              <div style={styles.unmatchedBox}>
                <strong style={{ display: 'block', marginBottom: '8px' }}>
                  Nicht gefundene Schiffe ({unmatchedVessels.length}):
                </strong>
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                  {unmatchedVessels.map((name) => (
                    <li key={name} style={{ marginBottom: '4px' }}>
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <h3 style={{ margin: '20px 0 10px', fontSize: '28px', fontWeight: 700 }}>
              Sendungen - ETA Abgleich
            </h3>

<<<<<<< codex/review-handover-file-for-testing-suggestions-ipr7vu
            <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: '14px' }}>
=======
            <p style={{ margin: '0 0 12px', color: '#4b5563', fontSize: '14px' }}>
>>>>>>> main
              Übersprungen (alt): {summary.skippedOld} · Übersprungen (verzollt):{' '}
              {summary.skippedCustoms}
              {typeof summary.autoAssignedShipments === 'number' ? (
                <> · Auto-Zuordnungen S-Nr.: {summary.autoAssignedShipments}</>
              ) : null}
<<<<<<< codex/review-handover-file-for-testing-suggestions-ipr7vu
              {typeof summary.autoAssignSkippedConflicts === 'number' && summary.autoAssignSkippedConflicts > 0 ? (
                <> · Konflikte (S-Nr. bereits bei anderem Schiff): {summary.autoAssignSkippedConflicts}</>
              ) : null}
=======
>>>>>>> main
            </p>

            {groupedEtaChanges.length > 0 ? (
              <div style={{ display: 'grid', gap: '12px' }}>
                {groupedEtaChanges.map((group) => (
                  <div key={group.vesselName} style={styles.matchCard}>
                    <div style={{ fontWeight: 700, fontSize: '32px', lineHeight: 1.2 }}>
                      {group.vesselName}
                    </div>
                    <div style={styles.statusBadge}>
                      {group.oldEta && group.newEta ? (
                        <>
                          von {group.oldEta} auf {group.newEta}
                          {group.dayDiff != null && (
                            <>
                              {' '}
                              ({group.dayDiff >= 0 ? '+' : ''}
                              {group.dayDiff} Tage)
                            </>
                          )}
                        </>
                      ) : (
                        'Keine Änderung'
                      )}
                    </div>

                    {group.shipmentRefs.length > 0 && (
                      <ul style={styles.shipmentList}>
                        {group.shipmentRefs.map((ref) => (
                          <li key={`${group.vesselName}-${ref}`} style={styles.shipmentRow}>
                            {ref}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={styles.emptyInfo}>Keine ETA-Änderungen gefunden.</div>
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
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
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
    color: 'var(--text-secondary)',
  },
  steps: {
    display: 'flex',
    justifyContent: 'center',
    gap: '32px',
    marginBottom: '28px',
    paddingBottom: '20px',
    borderBottom: '1px solid var(--border)',
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
    border: '2px dashed var(--border-strong)',
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
    border: '1px solid var(--border)',
    borderRadius: '8px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text-primary)',
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
    color: 'var(--text-primary)',
    backgroundColor: 'var(--surface-muted)',
    border: '1px solid var(--border)',
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
  matchCard: {
<<<<<<< codex/review-handover-file-for-testing-suggestions-ipr7vu
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '14px 16px',
    backgroundColor: 'var(--surface-muted)',
=======
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '14px 16px',
    backgroundColor: '#f9fafb',
>>>>>>> main
  },
  statusBadge: {
    display: 'inline-block',
    marginTop: '8px',
    marginBottom: '10px',
    padding: '4px 8px',
    borderRadius: '6px',
    backgroundColor: '#dcfce7',
    color: '#047857',
    fontWeight: 600,
    fontSize: '14px',
  },
  shipmentList: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  shipmentRow: {
<<<<<<< codex/review-handover-file-for-testing-suggestions-ipr7vu
    borderTop: '1px solid var(--border)',
=======
    borderTop: '1px solid #e5e7eb',
>>>>>>> main
    padding: '10px 2px 2px',
    fontSize: '15px',
  },
  unmatchedBox: {
    padding: '16px',
    backgroundColor: 'var(--surface-muted)',
    border: '1px solid #fde68a',
    borderRadius: '8px',
    fontSize: '14px',
    marginBottom: '12px',
  },
  emptyInfo: {
    padding: '14px',
    borderRadius: '8px',
<<<<<<< codex/review-handover-file-for-testing-suggestions-ipr7vu
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface-muted)',
    color: 'var(--text-primary)',
=======
    border: '1px solid #e5e7eb',
    backgroundColor: '#f9fafb',
    color: '#374151',
>>>>>>> main
    fontSize: '14px',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid var(--border)',
    borderTopColor: '#0066cc',
    borderRadius: '50%',
    margin: '0 auto',
    animation: 'spin 0.8s linear infinite',
  },
};
