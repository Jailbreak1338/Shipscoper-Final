'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  created_at: string;
  last_sign_in: string | null;
  upload_count: number;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    role: 'user' as 'admin' | 'user',
  });
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (res.status === 403) {
        router.push('/eta-updater');
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });

      const data = await res.json();

      if (res.ok) {
        setCreatedCredentials(data.credentials);
        setNewUser({ email: '', password: '', role: 'user' });
        fetchUsers();
      } else {
        setError(data.error || 'Failed to create user');
      }
    } catch {
      setError('Network error');
    }
  };

  const handleChangeRole = async (
    userId: string,
    newRole: 'admin' | 'user'
  ) => {
    if (!confirm(`Rolle zu "${newRole}" ändern?`)) return;

    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: newRole }),
      });

      if (res.ok) {
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update role');
      }
    } catch {
      alert('Network error');
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`User "${email}" löschen? Dies kann nicht rückgängig gemacht werden.`))
      return;

    try {
      const res = await fetch(`/api/admin/users?userId=${userId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete user');
      }
    } catch {
      alert('Network error');
    }
  };

  const generatePassword = () => {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*';
    let pw = '';
    for (let i = 0; i < 16; i++) {
      pw += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewUser((prev) => ({ ...prev, password: pw }));
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
        Lade Benutzer...
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Benutzerverwaltung</h1>
          <p style={styles.subtitle}>{users.length} Benutzer registriert</p>
        </div>
        <button
          onClick={() => {
            setShowCreateModal(true);
            setCreatedCredentials(null);
            setError('');
          }}
          style={styles.btnPrimary}
        >
          + Neuer Benutzer
        </button>
      </div>

      {/* Users Table */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Rolle</th>
              <th style={styles.th}>Uploads</th>
              <th style={styles.th}>Erstellt</th>
              <th style={styles.th}>Letzter Login</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td style={styles.td}>{user.email}</td>
                <td style={styles.td}>
                  <span
                    style={{
                      ...styles.badge,
                      backgroundColor:
                        user.role === 'admin' ? '#fef2f2' : '#f0fdf4',
                      color: user.role === 'admin' ? '#b91c1c' : '#15803d',
                      border: `1px solid ${user.role === 'admin' ? '#fecaca' : '#bbf7d0'}`,
                    }}
                  >
                    {user.role}
                  </span>
                </td>
                <td style={styles.td}>{user.upload_count}</td>
                <td style={{ ...styles.td, color: '#666', fontSize: '13px' }}>
                  {new Date(user.created_at).toLocaleDateString('de-DE')}
                </td>
                <td style={{ ...styles.td, color: '#666', fontSize: '13px' }}>
                  {user.last_sign_in
                    ? new Date(user.last_sign_in).toLocaleDateString('de-DE')
                    : 'Nie'}
                </td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  <select
                    value={user.role}
                    onChange={(e) =>
                      handleChangeRole(
                        user.id,
                        e.target.value as 'admin' | 'user'
                      )
                    }
                    style={styles.roleSelect}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => handleDeleteUser(user.id, user.email)}
                    style={styles.btnDelete}
                  >
                    Löschen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            {createdCredentials ? (
              <>
                <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>
                  Benutzer erstellt!
                </h2>
                <div style={styles.credentialsBox}>
                  <p style={{ margin: '0 0 8px' }}>
                    <strong>Email:</strong> {createdCredentials.email}
                  </p>
                  <p style={{ margin: '0 0 12px' }}>
                    <strong>Passwort:</strong>{' '}
                    <code style={{ backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                      {createdCredentials.password}
                    </code>
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '12px',
                      color: '#92400e',
                    }}
                  >
                    Zugangsdaten jetzt kopieren — werden nicht erneut angezeigt!
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `Email: ${createdCredentials.email}\nPasswort: ${createdCredentials.password}`
                      );
                    }}
                    style={styles.btnPrimary}
                  >
                    Kopieren
                  </button>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    style={styles.btnSecondary}
                  >
                    Schließen
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 style={{ margin: '0 0 20px', fontSize: '18px' }}>
                  Neuen Benutzer anlegen
                </h2>

                {error && <div style={styles.error}>{error}</div>}

                <form onSubmit={handleCreateUser}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Email</label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) =>
                        setNewUser((p) => ({ ...p, email: e.target.value }))
                      }
                      required
                      placeholder="name@firma.de"
                      style={styles.input}
                    />
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Passwort</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={newUser.password}
                        onChange={(e) =>
                          setNewUser((p) => ({ ...p, password: e.target.value }))
                        }
                        required
                        minLength={8}
                        placeholder="Min. 8 Zeichen"
                        style={{ ...styles.input, flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={generatePassword}
                        style={styles.btnSecondary}
                      >
                        Generieren
                      </button>
                    </div>
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Rolle</label>
                    <select
                      value={newUser.role}
                      onChange={(e) =>
                        setNewUser((p) => ({
                          ...p,
                          role: e.target.value as 'admin' | 'user',
                        }))
                      }
                      style={styles.input}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  <div
                    style={{ display: 'flex', gap: '8px', marginTop: '20px' }}
                  >
                    <button type="submit" style={{ ...styles.btnPrimary, flex: 1 }}>
                      Erstellen
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      style={styles.btnSecondary}
                    >
                      Abbrechen
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    padding: '32px 24px',
    maxWidth: '1100px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '24px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  title: {
    margin: '0 0 4px',
    fontSize: '24px',
    fontWeight: 700,
  },
  subtitle: {
    margin: 0,
    fontSize: '14px',
    color: '#666',
  },
  tableWrap: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    overflow: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: '13px',
    color: '#666',
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '12px 16px',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '14px',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 600,
  },
  roleSelect: {
    padding: '4px 8px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    fontSize: '13px',
    marginRight: '8px',
  },
  btnDelete: {
    padding: '4px 12px',
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
  },
  btnPrimary: {
    padding: '10px 20px',
    backgroundColor: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
  },
  btnSecondary: {
    padding: '10px 16px',
    backgroundColor: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '16px',
  },
  modal: {
    backgroundColor: '#fff',
    padding: '32px',
    borderRadius: '12px',
    maxWidth: '480px',
    width: '100%',
    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
  },
  credentialsBox: {
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  error: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '14px',
  },
  formGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '14px',
    fontWeight: 600,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    boxSizing: 'border-box' as CSSProperties['boxSizing'],
  },
};
