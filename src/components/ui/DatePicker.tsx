import { useRef, useEffect } from 'react';

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
}

export function DatePicker({ value, onChange, placeholder = 'DD-MMM-YYYY', title, className, style }: DatePickerProps) {
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  // Create hidden date input in document.body — completely outside any grid/flex container
  useEffect(() => {
    const input = document.createElement('input');
    input.type = 'date';
    input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;border:none;padding:0;margin:0;';
    input.addEventListener('change', (e) => {
      onChangeRef.current((e.target as HTMLInputElement).value);
    });
    document.body.appendChild(input);
    dateInputRef.current = input;
    return () => { document.body.removeChild(input); };
  }, []);

  // Keep hidden input's value in sync
  useEffect(() => {
    if (dateInputRef.current) dateInputRef.current.value = value || '';
  }, [value]);

  const open = () => {
    const input = dateInputRef.current;
    if (!input) return;
    try { input.showPicker(); } catch { input.click(); }
  };

  // Single element returned — guaranteed one grid/flex item
  return (
    <input
      type="text"
      readOnly
      className={className}
      value={value ? formatIsoToDisplay(value) : ''}
      placeholder={placeholder}
      title={title}
      onClick={open}
      onChange={() => {/* readOnly, no-op */}}
      style={{ cursor: 'pointer', caretColor: 'transparent', ...style }}
    />
  );
}
