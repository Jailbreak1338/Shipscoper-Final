'use client';

import { useState, useRef, type ChangeEvent } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Check,
  AlertCircle,
  Loader2,
  Download,
  RefreshCw,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface DetectedColumns {
  shipmentCol: string | null;
  vesselCol: string | null;
  etaCol: string | null;
  etaCols: string[];
  customsCol: string | null;
  containerCol: string | null;
  deliveryDateCol: string | null;
  allColumns: string[];
}

interface UpdateSummary {
  totalRows: number;
  matched: number;
  unmatched: number;
  skippedOld: number;
  skippedCustoms: number;
  unmatchedNames: string[];
  unmatchedRows: Array<{ shipmentRef: string | null; vesselName: string; eta: string | null }>;
  etaChanges: Array<{
    shipmentRef: string | null;
    vesselName: string;
    oldEta: string | null;
    newEta: string | null;
  }>;
  autoAssignedShipments?: number;
  autoAssignSkippedConflicts?: number;
}

type Step = 'upload' | 'columns' | 'processing' | 'result';

const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'columns', label: 'Spalten' },
  { id: 'result', label: 'Ergebnis' },
] as const;

function NativeSelect({
  value,
  onChange,
  children,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </select>
  );
}

export default function EtaUpdaterPage() {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [detected, setDetected] = useState<DetectedColumns | null>(null);
  const [shipmentCol, setShipmentCol] = useState('');
  const [vesselCol, setVesselCol] = useState('');
  const [etaCol, setEtaCol] = useState('');
  const [customsCol, setCustomsCol] = useState('');
  const [containerCol, setContainerCol] = useState('');
  const [deliveryDateCol, setDeliveryDateCol] = useState('');
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
        summary.unmatchedNames.map((n) => n.trim()).filter((n) => n && n !== '(empty)')
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
      { oldEta: string | null; newEta: string | null; dayDiff: number | null; shipmentRefs: string[] }
    >();

    for (const change of summary.etaChanges) {
      const vessel = change.vesselName.trim() || 'Unbekanntes Schiff';
      const existing = byVessel.get(vessel);
      const shipmentRef = (change.shipmentRef || '').trim();
      const oldTs = parseGermanDate(change.oldEta);
      const newTs = parseGermanDate(change.newEta);
      const dayDiff = oldTs != null && newTs != null ? Math.round((newTs - oldTs) / 86_400_000) : null;

      if (!existing) {
        byVessel.set(vessel, { oldEta: change.oldEta, newEta: change.newEta, dayDiff, shipmentRefs: shipmentRef ? [shipmentRef] : [] });
        continue;
      }
      if (shipmentRef && !existing.shipmentRefs.includes(shipmentRef)) {
        existing.shipmentRefs.push(shipmentRef);
      }
    }

    return Array.from(byVessel.entries()).map(([vesselName, data]) => ({ vesselName, ...data }));
  })();

  async function handleFileSelect(selectedFile: File) {
    setError('');
    setFile(selectedFile);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('mode', 'detect');
      const res = await fetch('/api/update-excel', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to read file'); setLoading(false); return; }
      const det: DetectedColumns = data.detected;
      setDetected(det);
      setShipmentCol(det.shipmentCol || '');
      setVesselCol(det.vesselCol || '');
      setEtaCol(det.etaCol || det.etaCols[0] || '');
      setCustomsCol(det.customsCol || '');
      setContainerCol(det.containerCol || '');
      setDeliveryDateCol(det.deliveryDateCol || '');
      setStep('columns');
    } catch {
      setError('Upload fehlgeschlagen. Bitte erneut versuchen.');
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
    if (!file || !vesselCol || !etaCol) { setError('Bitte Vessel-Spalte und ETA-Spalte auswählen.'); return; }
    setError('');
    setLoading(true);
    setStep('processing');
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (shipmentCol) formData.append('shipmentCol', shipmentCol);
      formData.append('vesselCol', vesselCol);
      formData.append('etaCols', etaCol);
      if (customsCol) formData.append('customsCol', customsCol);
      if (containerCol) formData.append('containerCol', containerCol);
      if (deliveryDateCol) formData.append('deliveryDateCol', deliveryDateCol);
      const res = await fetch('/api/update-excel', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Update fehlgeschlagen'); setStep('columns'); return; }
      setSummary(data.summary);
      setJobId(data.jobId);
      setStep('result');
    } catch {
      setError('Netzwerkfehler. Bitte erneut versuchen.');
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
    setContainerCol('');
    setDeliveryDateCol('');
    setSummary(null);
    setJobId('');
    setError('');
    setLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const activeStepIndex = step === 'processing' ? 2 : STEPS.findIndex((s) => s.id === step);

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">ETA Updater</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Excel hochladen und ETAs automatisch aus der Datenbank aktualisieren
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((s, i) => {
          const isDone = i < activeStepIndex;
          const isActive = i === activeStepIndex;
          return (
            <div key={s.id} className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-all',
                    isDone && 'bg-emerald-500 text-white',
                    isActive && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                    !isDone && !isActive && 'bg-muted text-muted-foreground'
                  )}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span className={cn('text-sm font-medium', isActive ? 'text-foreground' : 'text-muted-foreground')}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn('h-px w-8 bg-border', i < activeStepIndex && 'bg-emerald-500')} />
              )}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Step: Upload */}
      {step === 'upload' && (
        <Card>
          <CardContent className="p-0">
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all',
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-muted/30'
              )}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={onFileChange} className="hidden" aria-label="Excel-Datei auswählen" />
              <div className="flex flex-col items-center gap-3">
                {loading ? (
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                ) : (
                  <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <FileSpreadsheet className="h-7 w-7 text-primary" />
                  </div>
                )}
                <div>
                  <p className="font-semibold text-foreground">
                    {loading ? 'Datei wird analysiert…' : 'Excel-Datei ablegen'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    oder klicken zum Auswählen · .xlsx / .xls · max. 10 MB
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Columns */}
      {step === 'columns' && detected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spalten zuordnen</CardTitle>
            <CardDescription>
              Datei: <span className="font-medium text-foreground">{file?.name}</span> · Spalten automatisch erkannt
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label>Sendungsnummer-Spalte</Label>
                <NativeSelect label="Sendungsnummer-Spalte" value={shipmentCol} onChange={setShipmentCol}>
                  <option value="">— Keine —</option>
                  {detected.allColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                </NativeSelect>
              </div>

              <div className="space-y-2">
                <Label>Container-Spalte <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <NativeSelect label="Container-Spalte" value={containerCol} onChange={setContainerCol}>
                  <option value="">— Keine —</option>
                  {detected.allColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">Container-Nummern werden mit der S-Nr. in der Watchlist gespeichert.</p>
              </div>

              <div className="space-y-2">
                <Label>Anliefertermin-Spalte <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <NativeSelect label="Anliefertermin-Spalte" value={deliveryDateCol} onChange={setDeliveryDateCol}>
                  <option value="">— Keine —</option>
                  {detected.allColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">Erwarteter Anliefertermin — wird pro Container in der Sendungsübersicht angezeigt.</p>
              </div>

              <div className="space-y-2">
                <Label>
                  Vessel Name-Spalte <span className="text-destructive">*</span>
                </Label>
                <NativeSelect label="Vessel Name-Spalte" value={vesselCol} onChange={setVesselCol}>
                  <option value="">— Spalte wählen —</option>
                  {detected.allColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                </NativeSelect>
              </div>

              <div className="space-y-2">
                <Label>
                  ETA-Spalte <span className="text-destructive">*</span>
                </Label>
                <NativeSelect label="ETA-Spalte" value={etaCol} onChange={setEtaCol}>
                  <option value="">— Spalte wählen —</option>
                  {detected.allColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                </NativeSelect>
              </div>

              <div className="space-y-2">
                <Label>Verzollt-Spalte <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <NativeSelect label="Verzollt-Spalte" value={customsCol} onChange={setCustomsCol}>
                  <option value="">— Keine —</option>
                  {detected.allColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">Zeilen mit gefüllter Zelle werden übersprungen.</p>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={reset} className="flex-1">
                Zurück
              </Button>
              <Button
                onClick={handleUpdate}
                disabled={!vesselCol || !etaCol || loading}
                className="flex-1"
              >
                ETAs aktualisieren
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Processing */}
      {step === 'processing' && (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-foreground font-medium">ETAs werden abgeglichen…</p>
            <p className="text-sm text-muted-foreground mt-1">Dies kann einen Moment dauern</p>
          </CardContent>
        </Card>
      )}

      {/* Step: Result */}
      {step === 'result' && summary && (
        <div className="space-y-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-foreground">{summary.matched}</div>
                <div className="text-xs text-muted-foreground mt-1">Abgeglichen</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-amber-400">{summary.unmatched}</div>
                <div className="text-xs text-muted-foreground mt-1">Nicht gefunden</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-sky-400">{groupedEtaChanges.length}</div>
                <div className="text-xs text-muted-foreground mt-1">ETA-Änderungen</div>
              </CardContent>
            </Card>
          </div>

          {/* Unmatched Vessels */}
          {unmatchedVessels.length > 0 && (
            <Alert variant="warning">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <span className="font-semibold">{unmatchedVessels.length} Schiffe nicht gefunden:</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unmatchedVessels.map((name) => (
                    <Badge key={name} variant="outline" className="text-amber-400 border-amber-500/30">
                      {name}
                    </Badge>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* ETA Changes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">ETA-Änderungen</CardTitle>
              <CardDescription>
                Übersprungen (alt): {summary.skippedOld} · Verzollt: {summary.skippedCustoms}
                {typeof summary.autoAssignedShipments === 'number' &&
                  ` · Auto-Zuordnungen: ${summary.autoAssignedShipments}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {groupedEtaChanges.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Keine ETA-Änderungen gefunden.
                </div>
              ) : (
                <div className="space-y-3">
                  {groupedEtaChanges.map((group) => {
                    const isPositive = group.dayDiff != null && group.dayDiff > 0;
                    const isNegative = group.dayDiff != null && group.dayDiff < 0;
                    return (
                      <div key={group.vesselName} className="rounded-lg border border-border p-4 bg-card">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-lg text-foreground truncate">{group.vesselName}</p>
                            {group.oldEta && group.newEta && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-sm text-muted-foreground line-through">{group.oldEta}</span>
                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-sm font-semibold text-foreground">{group.newEta}</span>
                              </div>
                            )}
                            {group.shipmentRefs.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {group.shipmentRefs.map((ref) => (
                                  <Badge key={ref} variant="secondary" className="font-mono text-xs">
                                    {ref}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          {group.dayDiff != null && (
                            <Badge
                              className={cn(
                                'shrink-0 gap-1',
                                isPositive && 'bg-red-500/15 text-red-400 border-red-500/30',
                                isNegative && 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
                                !isPositive && !isNegative && 'bg-muted text-muted-foreground'
                              )}
                              variant="outline"
                            >
                              {isPositive ? <TrendingUp className="h-3 w-3" /> : isNegative ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                              {group.dayDiff > 0 ? '+' : ''}{group.dayDiff}d
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button asChild className="flex-1">
              <a href={`/api/download/${jobId}`} download>
                <Download className="h-4 w-4" />
                Excel herunterladen
              </a>
            </Button>
            <Button variant="outline" onClick={reset} className="flex-1">
              <RefreshCw className="h-4 w-4" />
              Neue Datei
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
