import { useEffect, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Field } from './Field';
import type { Approval } from '../lib/approval';

/**
 * Asked for in place, inside the dialog the cashier is already in: the manager
 * walks over, types their own name and password, and walks away again. It
 * never signs them in — the till stays with whoever is standing at it.
 */
export function ApprovalFields({
  value,
  onChange,
}: {
  value: Approval;
  onChange: (next: Approval) => void;
}) {
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  return (
    <div className="approval-block">
      <p className="warn-note">
        <ShieldAlert size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        This one needs a manager. Ask them to sign it off here; it does not sign you out.
      </p>

      <div className="row">
        <Field label="Manager's username" htmlFor="ap-user" required>
          <input
            id="ap-user"
            ref={first}
            autoComplete="off"
            value={value.username}
            onChange={(e) => onChange({ ...value, username: e.target.value })}
          />
        </Field>
        <Field label="Password" htmlFor="ap-pass" required>
          <input
            id="ap-pass"
            type="password"
            autoComplete="off"
            value={value.password}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}
