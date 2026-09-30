import { useState, type CSSProperties } from "react";

export function InlineText({
  value,
  onCommit,
  className,
  label,
  style,
}: {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  label: string;
  style?: CSSProperties;
}) {
  const [draft, setDraft] = useState<{ source: string; text: string } | null>(null);
  const text = draft && draft.source === value ? draft.text : value;

  return (
    <input
      aria-label={label}
      value={text}
      spellCheck={false}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft({ source: value, text: event.target.value })}
      onBlur={() => {
        if (text.trim()) onCommit(text.trim());
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={className}
      style={style}
    />
  );
}
