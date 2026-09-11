export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly T[]
  active: T
  onChange: (t: T) => void
}) {
  return (
    <div className="flex border-b border-border">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`flex-1 py-3 text-sm ${
            t === active ? 'border-b-2 border-accent text-text' : 'text-muted'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}
