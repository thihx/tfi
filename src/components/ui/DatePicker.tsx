import { useRef } from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatIsoToDisplay(iso: string): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  const mon = MONTHS[parseInt(month ?? '0') - 1];
  if (!mon || !day || !year) return iso;
  return `${day}-${mon}-${year}`;
}

interface DatePickerProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}

export function DatePicker({ value, onChange, placeholder = 'DD-MMM-YYYY', title, className, style, id }: DatePickerProps) {
  const dateInputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
      input.click();
    }
  };

  return (
    <span id={id} className="date-picker-field">
      <input
        type="text"
        readOnly
        className={className}
        value={value ? formatIsoToDisplay(value) : ''}
        placeholder={placeholder}
        title={title}
        onClick={openPicker}
        onChange={() => {/* readOnly, no-op */}}
        style={{ cursor: 'pointer', caretColor: 'transparent', width: '100%', boxSizing: 'border-box', ...style }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={dateInputRef}
        type="date"
        className="date-picker-field__native"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        title={title}
        aria-label={title || placeholder}
        onClick={(e) => {
          e.stopPropagation();
          openPicker();
        }}
      />
    </span>
  );
}
