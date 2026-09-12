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
    <div className="flex border-b border-rule">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          aria-current={t === active ? 'true' : undefined}
          className={`relative h-11 flex-1 text-[14px] ${
            t === active
              ? 'text-text after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:bg-text'
              : 'text-muted'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}
