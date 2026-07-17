import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

export type SearchableSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  onChange?: (value: string) => void;
};

export function SearchableSelect({
  name,
  value,
  defaultValue = '',
  options,
  placeholder = 'Select option',
  searchPlaceholder = 'Search...',
  emptyText = 'No matches',
  disabled = false,
  required = false,
  className = '',
  onChange,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [internalValue, setInternalValue] = useState(defaultValue);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedValue = value ?? internalValue;
  const selected = options.find((option) => option.value === selectedValue);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(term));
  }, [options, query]);

  useEffect(() => {
    if (value === undefined) setInternalValue(defaultValue);
  }, [defaultValue, value]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const choose = (nextValue: string, optionDisabled = false) => {
    if (optionDisabled || disabled) return;
    if (value === undefined) setInternalValue(nextValue);
    onChange?.(nextValue);
    setOpen(false);
    setQuery('');
  };

  return (
    <div
      ref={rootRef}
      className={`searchable-select ${open ? 'open' : ''} ${disabled ? 'disabled' : ''} ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      <select
        className="searchable-select-native"
        name={name}
        value={selectedValue}
        required={required}
        disabled={disabled}
        onChange={(event) => choose(event.target.value)}
        tabIndex={-1}
        aria-hidden="true"
      >
        {options.map((option, index) => <option key={`${option.value || '__empty'}-${index}`} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      <button type="button" className="searchable-select-trigger" disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <span>{selected?.label || placeholder}</span>
      </button>
      {open && (
        <div className="searchable-select-menu">
          <div className="searchable-select-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false);
              }}
            />
          </div>
          <div className="searchable-select-options">
            {filtered.length ? filtered.map((option, index) => (
              <button
                type="button"
                key={`${option.value || '__empty'}-${index}`}
                className={option.value === selectedValue ? 'selected' : ''}
                disabled={option.disabled}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  choose(option.value, option.disabled);
                }}
              >
                {option.label}
              </button>
            )) : <span className="searchable-select-empty">{emptyText}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
