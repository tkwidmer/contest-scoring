// A screenshot from public/landing (fictional contests only), light or dark to match the visitor.
export function Shot({ name, alt, className = '' }: { name: string; alt: string; className?: string }) {
  return (
    <picture>
      <source srcSet={`/landing/${name}-dark.png`} media="(prefers-color-scheme: dark)" />
      <img src={`/landing/${name}-light.png`} alt={alt} loading="lazy"
        className={`w-full rounded-lg border border-rule shadow-lg ${className}`} />
    </picture>
  )
}
