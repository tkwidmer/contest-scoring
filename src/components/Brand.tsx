// The Tallymaster.top wordmark. The .top is part of the name, so it's always shown.
export function Brand({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display font-extrabold uppercase tracking-wide ${className}`}>
      Tallymaster<span className="text-heart">.top</span>
    </span>
  )
}
