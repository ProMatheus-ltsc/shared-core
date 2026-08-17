/**
 * 底层字段输入组件集合
 * 复用自 root-cause-analysis / personal_review_system
 */
import { type ChangeEvent } from 'react';
import type { FormField, FieldOption } from '../../types';

interface FieldInputProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export function TextInput({ field, value, onChange, disabled }: FieldInputProps) {
  return (
    <input
      type="text"
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      disabled={disabled}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500 transition-all"
    />
  );
}

export function TextareaInput({ field, value, onChange, disabled }: FieldInputProps) {
  return (
    <textarea
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      disabled={disabled}
      rows={4}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500 resize-y min-h-[80px] transition-all"
    />
  );
}

export function NumberInput({ field, value, onChange, disabled }: FieldInputProps) {
  return (
    <input
      type="number"
      value={value !== undefined && value !== null ? String(value) : ''}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? undefined : Number(v));
      }}
      placeholder={field.placeholder}
      disabled={disabled}
      min={field.validation?.min}
      max={field.validation?.max}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500 transition-all"
    />
  );
}

export function DateInput({ field, value, onChange, disabled }: FieldInputProps) {
  return (
    <input
      type={field.type === 'datetime' ? 'datetime-local' : 'date'}
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500 transition-all"
    />
  );
}

export function SelectInput({ field, value, onChange, disabled }: FieldInputProps) {
  return (
    <select
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500 transition-all appearance-none bg-white"
    >
      <option value="">{field.placeholder ?? '请选择...'}</option>
      {field.options?.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function RadioInput({ field, value, onChange, disabled }: FieldInputProps) {
  return (
    <div className="flex flex-wrap gap-3">
      {field.options?.map((opt) => (
        <label
          key={opt.value}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm ${
            value === opt.value
              ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <input
            type="radio"
            name={field.id}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            disabled={disabled}
            className="sr-only"
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

export function CheckboxInput({ field, value, onChange, disabled }: FieldInputProps) {
  const selected = Array.isArray(value) ? value : [];

  const toggle = (optValue: string) => {
    const next = selected.includes(optValue)
      ? selected.filter((v: string) => v !== optValue)
      : [...selected, optValue];
    onChange(next);
  };

  return (
    <div className="flex flex-wrap gap-3">
      {field.options?.map((opt) => (
        <label
          key={opt.value}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm ${
            selected.includes(opt.value)
              ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <input
            type="checkbox"
            checked={selected.includes(opt.value)}
            onChange={() => toggle(opt.value)}
            disabled={disabled}
            className="sr-only"
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

export function RatingInput({ field, value, onChange, disabled }: FieldInputProps) {
  const max = field.validation?.max ?? 5;
  const current = typeof value === 'number' ? value : 0;

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => !disabled && onChange(n === current ? 0 : n)}
          disabled={disabled}
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
            n <= current
              ? 'bg-amber-400 text-white shadow-sm'
              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
          } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {n}
        </button>
      ))}
      <span className="ml-2 text-xs text-slate-500">{current}/{max}</span>
    </div>
  );
}
