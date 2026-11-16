import { useId } from 'react';

interface TextFieldProps {
  label: string;
  name: string;
  testId: string;
  type?: 'text' | 'email' | 'password';
  autoComplete: string;
  /** Fields are required unless this is false. */
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
  /** A line under the field saying what it wants. */
  hint?: string;
}

/** A labelled text input. Its value is read from the form when it is sent. */
export function TextField({ label, testId, type = 'text', required = true, hint, ...input }: TextFieldProps) {
  const id = useId();
  return (
    <div className="sb-field">
      <label className="sb-label" htmlFor={id}>
        {label}
      </label>
      <input
        {...input}
        id={id}
        className="sb-input"
        data-testid={testId}
        type={type}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p className="sb-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  name: string;
  testId: string;
  autoComplete: string;
  value: string;
  onChange(value: string): void;
  options: Array<{ value: string; label: string }>;
  /** Shown first, standing for no choice made yet. */
  placeholder?: string;
}

/** A labelled choice from a list. */
export function SelectField({ label, testId, onChange, options, placeholder, ...select }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="sb-field">
      <label className="sb-label" htmlFor={id}>
        {label}
      </label>
      <select
        {...select}
        id={id}
        className="sb-input"
        data-testid={testId}
        required
        onChange={(event) => onChange(event.target.value)}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
