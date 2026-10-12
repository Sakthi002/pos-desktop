import { useCallback, useEffect, useState } from 'react';
import { Plus, FolderTree, Pencil, Trash2, Check, X } from 'lucide-react';
import { call } from '../lib/ipc';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Category } from '@shared/catalogue';

export function Categories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [removing, setRemoving] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await call('catalogue:listCategories'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      setCategories(await call('catalogue:createCategory', { name: newName.trim() }));
      setNewName('');
      setAdding(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string) {
    if (!editName.trim()) return;
    setBusy(true);
    try {
      setCategories(await call('catalogue:renameCategory', { id, name: editName.trim() }));
      setEditingId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      const result = await call('catalogue:removeCategory', { id: removing.id });
      setCategories(result.categories);
      setRemoving(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Categories</h1>
          <p className="sub">Group products so they are quicker to find at the till</p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> New category
        </button>
      </header>

      {error && (
        <p className="field-error" role="alert" style={{ padding: '0 28px' }}>
          {error}
        </p>
      )}

      {adding && (
        <div className="inline-add">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="Category name"
          />
          <button className="btn-primary" onClick={() => void create()} disabled={busy}>
            Add
          </button>
          <button className="btn-secondary" onClick={() => setAdding(false)} disabled={busy}>
            Cancel
          </button>
        </div>
      )}

      {loading ? (
        <p className="empty">Loading…</p>
      ) : categories.length === 0 ? (
        <div className="empty-state">
          <FolderTree size={34} />
          <h2>No categories yet</h2>
          <p>Categories are optional, but they make the billing screen faster to use.</p>
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> New category
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Products</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className={c.isActive ? '' : 'muted-row'}>
                  <td>
                    {editingId === c.id ? (
                      <div className="inline-edit">
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void rename(c.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <button className="icon-btn" onClick={() => void rename(c.id)} title="Save">
                          <Check size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => setEditingId(null)}
                          title="Cancel"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ) : (
                      <strong>{c.name}</strong>
                    )}
                  </td>
                  <td className="num">{c.productCount}</td>
                  <td>
                    {c.isActive ? (
                      <span className="badge ok">Active</span>
                    ) : (
                      <span className="pill">Inactive</span>
                    )}
                  </td>
                  <td className="actions">
                    <button
                      className="icon-btn"
                      title="Rename"
                      onClick={() => {
                        setEditingId(c.id);
                        setEditName(c.name);
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Remove"
                      onClick={() => setRemoving(c)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title="Remove category"
          message={
            removing.productCount > 0
              ? `"${removing.name}" is used by ${removing.productCount} product(s), so it will be made inactive rather than deleted. Those products keep their category.`
              : `Remove "${removing.name}"? Nothing uses it, so it will be deleted.`
          }
          confirmLabel={removing.productCount > 0 ? 'Make inactive' : 'Delete'}
          destructive
          busy={busy}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
