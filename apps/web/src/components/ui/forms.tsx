import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cx, type DataAttrs } from "./cx";
import { Icon } from "./icons";
import { Spinner } from "./primitives";

// Form parts (Sprint 12g stage 1a). Labels sit above the control; "必須" is text; errors sit right under the control.
// Inputs are 16px or larger (no zoom on iOS), 44px tall (56px in field mode), with a 1px line-strong rule (3:1) on a
// lighter paper cell. No inner shadow and no glow: focus is the 2px outline from globals.css plus an accent rule.

export const controlId = (base: string, part: "hint" | "error"): string => `${base}-${part}`;

/** aria-describedby for a control that has a hint and/or an error. */
export const describedBy = (id: string, o: { readonly hint?: boolean; readonly error?: boolean }): string | undefined => {
  const ids = [o.hint ? controlId(id, "hint") : "", o.error ? controlId(id, "error") : ""].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
};

export function FormField({
  id,
  label,
  required,
  optional,
  hint,
  error,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  readonly optional?: boolean;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center gap-2 text-table font-medium text-fg">
        {label}
        {required ? <span className="rounded-ctl border border-line-strong px-1.5 text-aux font-medium text-fg-soft">必須</span> : null}
        {optional ? <span className="text-aux font-normal text-fg-mute">任意</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={controlId(id, "hint")} className="text-aux text-fg-mute">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={controlId(id, "error")} className="flex items-start gap-1.5 text-aux font-medium text-danger-fg">
          <Icon name="ban" size={14} className="mt-1 shrink-0 text-danger-line" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "block w-full min-w-0 rounded-ctl border border-line-strong bg-surface px-3 text-[1rem] text-fg placeholder:text-fg-mute transition-colors duration-[var(--dur)] min-h-11 field:min-h-14 field:text-[1.125rem] " +
  "hov:border-fg foc:border-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken disabled:text-fg-mute";
const CONTROL_ERROR = "!border-danger-line";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { readonly invalid?: boolean; readonly loading?: boolean };

export function TextInput({ invalid, loading, className, ...rest }: TextInputProps) {
  return (
    <span className="relative block">
      <input {...rest} aria-invalid={invalid || undefined} aria-busy={loading || undefined} className={cx(CONTROL, invalid && CONTROL_ERROR, loading && "pr-10", className)} />
      {loading ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-fg-mute">
          <Spinner size={16} />
        </span>
      ) : null}
    </span>
  );
}

export function Select({ invalid, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { readonly invalid?: boolean }) {
  return (
    <span className="relative block">
      <select {...rest} aria-invalid={invalid || undefined} className={cx(CONTROL, "appearance-none pr-9", invalid && CONTROL_ERROR, className)}>
        {children}
      </select>
      <Icon name="chevron-down" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-mute" />
    </span>
  );
}

export function Textarea({ invalid, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { readonly invalid?: boolean }) {
  return <textarea {...rest} aria-invalid={invalid || undefined} className={cx(CONTROL, "min-h-24 py-2.5 leading-[1.7]", invalid && CONTROL_ERROR, className)} />;
}

/** Search field with a leading icon. */
export function SearchInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <span className="relative block">
      <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-mute" />
      <input {...rest} type="search" className={cx(CONTROL, "pl-10", className)} />
    </span>
  );
}

const CHOICE_ROW =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-ctl px-1 py-2.5 text-body text-fg field:min-h-14 has-[:disabled]:cursor-not-allowed has-[:disabled]:text-fg-mute";
const CHOICE_INPUT = "mt-0.5 h-5 w-5 shrink-0 accent-accent field:h-6 field:w-6 disabled:cursor-not-allowed";

export function Checkbox({ label, hint, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { readonly label: ReactNode; readonly hint?: ReactNode }) {
  return (
    <label className={cx(CHOICE_ROW, className)}>
      <input {...rest} type="checkbox" className={CHOICE_INPUT} />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {hint ? <span className="text-aux text-fg-mute">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Radio({ label, hint, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { readonly label: ReactNode; readonly hint?: ReactNode }) {
  return (
    <label className={cx(CHOICE_ROW, className)}>
      <input {...rest} type="radio" className={CHOICE_INPUT} />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {hint ? <span className="text-aux text-fg-mute">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Switch. Controlled: pass `checked` and `onChange`. role="switch". A square-cornered track; the thumb slides, and the state is also in the label next to it. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  id,
  ...rest
}: {
  readonly checked: boolean;
  readonly onChange?: (next: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
  readonly id?: string;
} & DataAttrs) {
  return (
    <button
      {...rest}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-ctl field:min-h-14 field:min-w-14 disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        className={cx(
          "relative inline-flex h-7 w-[50px] shrink-0 items-center rounded-ctl border transition-colors duration-[var(--dur)]",
          disabled ? "border-line bg-sunken" : checked ? "border-accent-solid bg-accent-solid" : "border-line-strong bg-sunken",
        )}
      >
        <span
          className={cx(
            "absolute left-[3px] h-5 w-5 rounded-ctl transition-transform duration-[var(--dur)] ease-[var(--ease)]",
            checked && "translate-x-[22px]",
            disabled ? "bg-line-strong" : checked ? "bg-accent-fg" : "bg-fg-mute",
          )}
        />
      </span>
    </button>
  );
}

/** Grouped list (iOS "inset grouped"): rows inside one tonal surface, separated by hairlines. */
export function FormGroup({ title, footer, children, ...rest }: { readonly title?: string; readonly footer?: ReactNode; readonly children: ReactNode } & DataAttrs) {
  return (
    <section {...rest} className="flex flex-col gap-2">
      {title ? <h3 className="px-1 text-aux font-semibold text-fg-mute">{title}</h3> : null}
      <div className="flex flex-col divide-y divide-line rounded-ctl border border-line bg-surface px-4 [&>*]:py-3">{children}</div>
      {footer ? <p className="px-1 text-aux text-fg-mute">{footer}</p> : null}
    </section>
  );
}

/** A row inside a FormGroup: label and value/control side by side (stacked on a narrow screen). */
export function FormRow({ label, children, htmlFor }: { readonly label: string; readonly children: ReactNode; readonly htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
      <label htmlFor={htmlFor} className="text-table font-medium text-fg sm:w-40 sm:shrink-0">
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Error summary shown at the top of a form (the per-field message stays under each control). */
export function ErrorSummary({ errors, ...rest }: { readonly errors: readonly { readonly id: string; readonly message: string }[] } & DataAttrs) {
  if (errors.length === 0) return null;
  return (
    <div {...rest} role="alert" className="rounded-ctl border border-danger-line bg-danger-bg px-4 py-3 text-table text-danger-fg">
      <p className="flex items-center gap-2 font-semibold">
        <Icon name="ban" size={16} className="text-danger-line" />
        入力を確かめてください（{errors.length} 件）
      </p>
      <ul className="mt-1 list-disc pl-9">
        {errors.map((e) => (
          <li key={e.id}>
            <a href={`#${e.id}`} className="inline-flex min-h-11 items-center underline underline-offset-2 field:min-h-14">
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A bar fixed to the bottom of a long form (opaque). */
export function SaveBar({ children, status, ...rest }: { readonly children: ReactNode; readonly status?: ReactNode } & DataAttrs) {
  return (
    <div {...rest} className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-0 sm:rounded-ctl sm:border sm:px-4">
      <div className="min-w-0 text-table text-fg-soft">{status}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
