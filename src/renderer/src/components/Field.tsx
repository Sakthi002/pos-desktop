import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  /** Settings are not a form to submit; "(optional)" there is just noise. */
  plainLabel?: boolean;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, plainLabel, children }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            {' '}
            *
          </span>
        )}
        {!required && !plainLabel && <span className="optional"> (optional)</span>}
      </label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}
