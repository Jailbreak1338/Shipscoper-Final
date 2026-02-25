'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, UserPlus, Trash2, CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  created_at: string;
  last_sign_in: string | null;
  upload_count: number;
}

export default function AdminUsersPage() {
  const [users, setUsers]               = useState<User[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showModal, setShowModal]       = useState(false);
  const [email, setEmail]               = useState('');
  const [role, setRole]                 = useState<'admin' | 'user'>('user');
  const [submitting, setSubmitting]     = useState(false);
  const [invited, setInvited]           = useState<string | null>(null);
  const [error, setError]               = useState('');
  const router = useRouter();

  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (res.status === 403) { router.push('/eta-updater'); return; }
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Fehler');
      setInvited(email);
      setEmail('');
      setRole('user');
      fetchUsers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeRole = async (userId: string, newRole: 'admin' | 'user') => {
    if (!confirm(`Rolle zu "${newRole}" ändern?`)) return;
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: newRole }),
    });
    if (res.ok) fetchUsers();
    else { const d = await res.json(); alert(d.error ?? 'Fehler'); }
  };

  const handleDelete = async (userId: string, userEmail: string) => {
    if (!confirm(`Benutzer "${userEmail}" löschen?`)) return;
    const res = await fetch(`/api/admin/users?userId=${userId}`, { method: 'DELETE' });
    if (res.ok) fetchUsers();
    else { const d = await res.json(); alert(d.error ?? 'Fehler'); }
  };

  const closeModal = () => { setShowModal(false); setInvited(null); setError(''); setEmail(''); setRole('user'); };

  const SELECT_CLS = 'h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Lade Benutzer…
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Benutzerverwaltung</h1>
          <p className="text-sm text-muted-foreground mt-1">{users.length} Benutzer registriert</p>
        </div>
        <Button onClick={() => { setShowModal(true); setInvited(null); setError(''); }} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Neuer Benutzer
        </Button>
      </div>

      {/* Users table */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wide">E-Mail</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Rolle</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Uploads</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Erstellt</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Letzter Login</TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                  Keine Benutzer vorhanden.
                </TableCell>
              </TableRow>
            ) : users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="text-sm font-medium">{u.email}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn('text-xs', u.role === 'admin'
                      ? 'border-red-500/40 bg-red-500/10 text-red-400'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400')}
                  >
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.upload_count}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString('de-DE')}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {u.last_sign_in ? new Date(u.last_sign_in).toLocaleDateString('de-DE') : 'Nie'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-2">
                    <select
                      value={u.role}
                      onChange={(e) => handleChangeRole(u.id, e.target.value as 'admin' | 'user')}
                      className={SELECT_CLS}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(u.id, u.email)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Löschen
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Invite modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6">

            {/* Modal header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-foreground">Neuen Benutzer einladen</h2>
              <button type="button" onClick={closeModal} aria-label="Modal schließen" className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {invited ? (
              /* Success state */
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Einladung gesendet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      <strong>{invited}</strong> hat eine E-Mail mit einem Link erhalten, um ein Passwort zu setzen.
                    </p>
                  </div>
                </div>
                <Button onClick={closeModal} className="w-full">Schließen</Button>
              </div>
            ) : (
              /* Invite form */
              <form onSubmit={handleInvite} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">E-Mail</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="name@firma.de"
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Rolle</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
                    className={cn(SELECT_CLS, 'w-full')}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                <p className="text-xs text-muted-foreground">
                  Der Benutzer erhält eine E-Mail mit einem Link, um sein Passwort selbst festzulegen.
                </p>

                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={submitting} className="flex-1 gap-2">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Einladung senden
                  </Button>
                  <Button type="button" variant="outline" onClick={closeModal}>
                    Abbrechen
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
