import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import "./SearchCombobox.scss";

export interface SearchComboboxOption {
  value: string;
  label: string;
  description?: string;
  meta?: string;
  keywords?: string;
  disabled?: boolean;
  alwaysVisible?: boolean;
}

interface SearchComboboxProps {
  id: string;
  value: string;
  options: SearchComboboxOption[];
  placeholder: string;
  emptyMessage?: string;
  loading?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}

export default function SearchCombobox({
  id,
  value,
  options,
  placeholder,
  emptyMessage = "검색 결과가 없습니다.",
  loading = false,
  disabled = false,
  autoFocus = false,
  onChange,
}: SearchComboboxProps) {
  const reactId = useId();
  const listboxId = `${id}-${reactId.replace(/:/g, "")}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);
  const selectedDisplay = selected
    ? [selected.label, selected.description].filter(Boolean).join(" · ")
    : "";

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalized) return options;
    return options.filter((option) => option.alwaysVisible ||
      [option.label, option.description, option.meta, option.keywords]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ko-KR")
        .includes(normalized));
  }, [options, query]);
  const resultCount = filteredOptions.filter((option) => !option.alwaysVisible).length;

  useEffect(() => {
    if (!isOpen) return;
    const selectedIndex = filteredOptions.findIndex((option) => option.value === value && !option.disabled);
    const firstEnabledIndex = filteredOptions.findIndex((option) => !option.disabled);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : Math.max(0, firstEnabledIndex));
  }, [filteredOptions, isOpen, value]);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  function open() {
    if (disabled) return;
    setIsOpen(true);
    setQuery("");
  }

  function select(option: SearchComboboxOption) {
    if (option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
    setQuery("");
    inputRef.current?.focus();
  }

  function moveActive(direction: 1 | -1) {
    if (filteredOptions.length === 0) return;
    let next = activeIndex;
    for (let attempts = 0; attempts < filteredOptions.length; attempts += 1) {
      next = (next + direction + filteredOptions.length) % filteredOptions.length;
      if (!filteredOptions[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) open();
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && isOpen) {
      const option = filteredOptions[activeIndex];
      if (option && !option.disabled) {
        event.preventDefault();
        select(option);
      }
      return;
    }
    if ((event.key === "Home" || event.key === "End") && isOpen) {
      event.preventDefault();
      const indexes = filteredOptions
        .map((option, index) => option.disabled ? -1 : index)
        .filter((index) => index >= 0);
      const next = event.key === "Home" ? indexes[0] : indexes[indexes.length - 1];
      if (next !== undefined) setActiveIndex(next);
      return;
    }
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      setQuery("");
      return;
    }
    if (event.key === "Tab" && isOpen) {
      setIsOpen(false);
      setQuery("");
    }
  }

  const activeOption = isOpen ? filteredOptions[activeIndex] : undefined;

  return (
    <div className={`search-combobox ${isOpen ? "is-open" : ""} ${disabled ? "is-disabled" : ""}`} ref={rootRef}>
      <div className="search-combobox-control">
        <Search size={14} strokeWidth={1.8} aria-hidden="true" />
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeOption ? `${listboxId}-${activeIndex}` : undefined}
          value={isOpen ? query : selectedDisplay}
          placeholder={loading ? "Jira 티켓 불러오는 중…" : placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={open}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        <button type="button" tabIndex={-1} aria-label={isOpen ? "목록 닫기" : "목록 열기"} disabled={disabled} onClick={() => {
          if (isOpen) {
            setIsOpen(false);
            setQuery("");
          } else {
            open();
            inputRef.current?.focus();
          }
        }}>
          <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      {isOpen && (
        <div className="search-combobox-popover">
          <div className="search-combobox-caption">
            <span>{query ? `“${query}” 검색 결과` : "내게 할당된 Jira 티켓"}</span>
            <b>{resultCount}개</b>
          </div>
          <div className="search-combobox-list" id={listboxId} role="listbox">
            {resultCount === 0 && <div className="search-combobox-empty">{emptyMessage}</div>}
            {filteredOptions.map((option, index) => (
              <button
                id={`${listboxId}-${index}`}
                className={`${index === activeIndex ? "active" : ""} ${option.disabled ? "disabled" : ""} ${option.alwaysVisible ? "always-visible" : ""}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled}
                key={option.value}
                onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(option)}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
                <span className="search-combobox-option-meta">
                  {option.meta && <em>{option.meta}</em>}
                  {option.value === value && <Check size={14} strokeWidth={2} aria-hidden="true" />}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
