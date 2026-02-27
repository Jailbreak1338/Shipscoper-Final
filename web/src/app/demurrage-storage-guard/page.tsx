'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Upload, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
  skippedCustoms: number;
  autoAssignedShipments?: number;
}

interface GuardRow {
  watch_id: string;
  shipment_reference: string | null;
  eta: string | null;
  delivery_date: string | null;
  container_no: string;
  normalized_status: string | null;
  has_container: boolean;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('de-DE');
}

export default function DemurrageStorageGuardPage() {
  const [file, setFile] = useState<File | null>(null);
  const [detected, setDetected] = useState<DetectedColumns | null>(null);
  const [shipmentCol, setShipmentCol] = useState('');
  const [vesselCol, setVesselCol] = useState('');
  const [etaCol, setEtaCol] = useState('');
  const [customsCol, setCustomsCol] = useState('');
  const [containerCol, setContainerCol] = useState('');
  const [deliveryDateCol, setDeliveryDateCol] = useState('');
  const [summary, setSummary] = useState<UpdateSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<GuardRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [query, setQuery] = useState('');

  const loadRows = async () => {
    setRowsLoading(true);
    try {
      const res = await fetch('/api/sendungen');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Fehler beim Laden');
      setRows((json.sendungen ?? []).filter((r: GuardRow) => r.has_container));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Laden der Sendungen');
    } finally {
      setRowsLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, []);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.shipment_reference ?? '').toLowerCase().includes(q) ||
      (r.container_no ?? '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  async function handleFileSelect(selectedFile: File) {
    setError('');
    setSummary(null);
    setFile(selectedFile);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('mode', 'detect');
      const res = await fetch('/api/update-excel', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Spaltenerkennung fehlgeschlagen');
      const det: DetectedColumns = data.detected;
      setDetected(det);
      setShipmentCol(det.shipmentCol ?? '');
      setVesselCol(det.vesselCol ?? '');
      setEtaCol(det.etaCol ?? det.etaCols[0] ?? '');
      setCustomsCol(det.customsCol ?? '');
      setContainerCol(det.containerCol ?? '');
      setDeliveryDateCol(det.deliveryDateCol ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFileSelect(f);
  };

  const runUpdate = async () => {
    if (!file || !vesselCol || !etaCol) {
      setError('Bitte Datei + Vessel- und ETA-Spalte auswählen.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (shipmentCol) fd.append('shipmentCol', shipmentCol);
      fd.append('vesselCol', vesselCol);
      fd.append('etaCols', etaCol);
      if (customsCol) fd.append('customsCol', customsCol);
      if (containerCol) fd.append('containerCol', containerCol);
      if (deliveryDateCol) fd.append('deliveryDateCol', deliveryDateCol);

      const res = await fetch('/api/update-excel', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verarbeitung fehlgeschlagen');
      setSummary(data.summary as UpdateSummary);
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verarbeitung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Demurrage / Storage Guard</h1>
        <p className="text-sm text-muted-foreground">Excel hochladen, Container extrahieren und Live-Status mit S-Nr., ETA und Anlieferdatum überwachen.</p>
      </div>

      {error && <Alert><AlertDescription>{error}</AlertDescription></Alert>}

      <Card>
        <CardHeader>
          <CardTitle>1) Excel Upload</CardTitle>
          <CardDescription>Rows mit Verzollt = X werden beim Update übersprungen.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={onFileChange} />
          {detected && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input value={shipmentCol} onChange={(e) => setShipmentCol(e.target.value)} placeholder="Shipment-Spalte" />
              <Input value={vesselCol} onChange={(e) => setVesselCol(e.target.value)} placeholder="Vessel-Spalte" />
              <Input value={etaCol} onChange={(e) => setEtaCol(e.target.value)} placeholder="ETA-Spalte" />
              <Input value={containerCol} onChange={(e) => setContainerCol(e.target.value)} placeholder="Container-Spalte" />
              <Input value={deliveryDateCol} onChange={(e) => setDeliveryDateCol(e.target.value)} placeholder="Anlieferdatum-Spalte" />
              <Input value={customsCol} onChange={(e) => setCustomsCol(e.target.value)} placeholder="Verzollt-Spalte" />
            </div>
          )}
          <Button onClick={runUpdate} disabled={loading || !file}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            Upload verarbeiten
          </Button>
          {summary && (
            <div className="text-sm text-muted-foreground">
              {summary.totalRows} Zeilen · {summary.matched} matched · {summary.unmatched} unmatched · {summary.skippedCustoms} Verzollt/X übersprungen · {summary.autoAssignedShipments ?? 0} Watch-Updates
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>2) Container Monitor</CardTitle>
            <CardDescription>S-Nr., ETA, Anlieferdatum und aktueller Status aus der Datenbank.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadRows()} disabled={rowsLoading}>
            <RefreshCw className="h-4 w-4 mr-2" /> Neu laden
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Filter nach S-Nr. oder Container…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {rowsLoading ? (
            <div className="text-sm text-muted-foreground">Lade…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>S-Nr.</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Anlieferdatum</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((r) => (
                  <TableRow key={`${r.watch_id}-${r.container_no}-${r.shipment_reference ?? 'na'}`}>
                    <TableCell>{r.shipment_reference ?? '—'}</TableCell>
                    <TableCell className="font-mono">{r.container_no || '—'}</TableCell>
                    <TableCell>{fmtDate(r.eta)}</TableCell>
                    <TableCell>{fmtDate(r.delivery_date)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.normalized_status ?? 'AUSSTEHEND'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
