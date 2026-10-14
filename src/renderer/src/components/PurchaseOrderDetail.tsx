import { useEffect, useState } from 'react';
import { Printer, PackageCheck, Ban } from 'lucide-react';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import { PurchaseOrderPreview } from './PurchaseOrderPreview';
import { call } from '../lib/ipc';
import { formatPaise } from '@shared/money';
import { formatQuantity, precisionFor } from '@shared/quantity';
import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrder } from '@shared/purchase-orders';

const formatDate = (iso: string | null): string => {
  if (!iso) return 'no date given';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/**
 * One order, as it was sent. Nothing here edits it: an order a supplier has
 * been given is a thing that happened, so a mistake is called off with a
 * reason and ordered again.
 */
export function PurchaseOrderDetail({
  orderId,
  onClose,
  onReceive,
}: {
  orderId: string;
  onClose: () => void;
  onReceive: (orderId: string) => void;
}) {
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void call('purchaseOrders:get', { id: orderId })
      .then((result) => {
        if (!cancelled) setOrder(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  async function cancel(reason: string) {
    setBusy(true);
    setError(null);
    try {
      setOrder(await call('purchaseOrders:cancel', { id: orderId, reason }));
      setCancelling(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const open = order?.status === 'open' || order?.status === 'overdue';

  if (cancelling && order)
    return (
      <ConfirmDialog
        title={`Call off order ${order.orderNumber}`}
        message="It stays on the list as cancelled, with the reason beside it, and no goods can be received against it. A new order is how the same goods are asked for again."
        confirmLabel="Call off the order"
        destructive
        busy={busy}
        reasonLabel="Why is it being called off"
        reasonPlaceholder="Supplier out of stock"
        onConfirm={(reason) => void cancel(reason)}
        onCancel={() => setCancelling(false)}
      />
    );

  if (previewing && order)
    return (
      <PurchaseOrderPreview
        orderId={orderId}
        orderNumber={order.orderNumber}
        onClose={() => setPreviewing(false)}
      />
    );

  return (
    <Modal
      title={order ? `Order ${order.orderNumber}` : 'Purchase order'}
      onClose={onClose}
      width={760}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Close
          </button>
          {open && (
            <button className="btn-warn" onClick={() => setCancelling(true)} disabled={busy}>
              <Ban size={15} /> Call it off
            </button>
          )}
          <button
            className="btn-info"
            onClick={() => setPreviewing(true)}
            disabled={busy || !order}
          >
            <Printer size={15} /> Print
          </button>
          {open && (
            <button className="btn-primary" onClick={() => onReceive(orderId)}>
              <PackageCheck size={15} /> Goods arrived
            </button>
          )}
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {!order ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <div className="dash-row" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="stat-text">
                <strong className="stat-value">{formatPaise(order.totalPaise)}</strong>
                <span className="stat-label">Order value</span>
                <span className="stat-note">
                  {order.supplierName} · wanted by {formatDate(order.expectedOn)}
                </span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-text">
                <strong className="stat-value">
                  {PURCHASE_ORDER_STATUS_LABELS[order.status]}
                </strong>
                <span className="stat-label">Status</span>
                {order.receivedPurchaseNumber && (
                  <span className="stat-note">Received as {order.receivedPurchaseNumber}</span>
                )}
                {order.cancelReason && <span className="stat-note">{order.cancelReason}</span>}
              </div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Quantity</th>
                  <th className="num">Cost</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.lineNo}>
                    <td>
                      <strong>{line.name}</strong>
                      {line.sku && <span className="sub-cell">{line.sku}</span>}
                    </td>
                    <td className="num">
                      {formatQuantity(line.quantityMilli, precisionFor(line.unitCode))}{' '}
                      {line.unitCode}
                    </td>
                    <td className="num">{formatPaise(line.unitCostPaise)}</td>
                    <td className="num">{formatPaise(line.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="detail-foot">
            <div className="detail-payments">
              <h3>Not a bill</h3>
              <p className="field-hint">
                No stock has moved and nothing is owed. That happens when the goods arrive and
                their bill is entered, and the bill is a new document that points back here.
              </p>
              {order.notes && <p className="field-hint">{order.notes}</p>}
            </div>

            <div className="totals">
              <div className="t-row grand">
                <span>Order value</span>
                <span>{formatPaise(order.totalPaise)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
