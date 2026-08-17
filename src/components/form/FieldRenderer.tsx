/**
 * 字段渲染器：根据字段类型分发到对应的输入组件
 * 复用自 root-cause-analysis / personal_review_system
 */
import { memo } from 'react';
import type { FormField } from '../../types';
import {
  TextInput,
  TextareaInput,
  NumberInput,
  DateInput,
  SelectInput,
  RadioInput,
  CheckboxInput,
  RatingInput,
} from './FieldInputs';

interface FieldRendererProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export const FieldRenderer = memo(function FieldRenderer({
  field,
  value,
  onChange,
  disabled = false,
}: FieldRendererProps) {
  if (field.type === 'hidden') return null;

  const inputProps = { field, value, onChange, disabled };

  const renderInput = () => {
    switch (field.type) {
      case 'text':
        return <TextInput {...inputProps} />;
      case 'textarea':
        return <TextareaInput {...inputProps} />;
      case 'number':
        return <NumberInput {...inputProps} />;
      case 'date':
      case 'datetime':
        return <DateInput {...inputProps} />;
      case 'select':
        return <SelectInput {...inputProps} />;
      case 'radio':
        return <RadioInput {...inputProps} />;
      case 'checkbox':
        return <CheckboxInput {...inputProps} />;
      case 'rating':
        return <RatingInput {...inputProps} />;
      default:
        return <TextInput {...inputProps} />;
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {field.label}
        {field.required && <span className="text-red-500 text-xs">*</span>}
        {field.priority === 'optional' && (
          <span className="text-xs text-slate-400 font-normal">(可选)</span>
        )}
      </label>
      {field.hint && (
        <p className="text-xs text-slate-500">{field.hint}</p>
      )}
      {renderInput()}
    </div>
  );
});
