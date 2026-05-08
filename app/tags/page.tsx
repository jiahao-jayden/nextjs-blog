import Link from '@/components/Link'
import { slug } from 'github-slugger'
import tagData from 'app/tag-data.json'
import { genPageMetadata } from 'app/seo'

export const metadata = genPageMetadata({ title: 'Tags', description: 'Things I blog about' })

export default async function Page() {
  const tagCounts = tagData as Record<string, number>
  const tagKeys = Object.keys(tagCounts)
  const sortedTags = tagKeys.sort((a, b) => tagCounts[b] - tagCounts[a])
  return (
    <div className="pt-10">
      <h1 className="text-charcoal dark:text-dark-text font-serif text-[clamp(2rem,4vw,2.5rem)] font-normal tracking-tight">
        Tags
      </h1>
      <div className="border-divider dark:border-dark-divider mt-8 flex flex-wrap gap-x-6 gap-y-3 border-t pt-8">
        {tagKeys.length === 0 && (
          <p className="text-muted dark:text-dark-muted text-sm">No tags found.</p>
        )}
        {sortedTags.map((t) => (
          <Link
            key={t}
            href={`/tags/${slug(t)}`}
            className="text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text text-sm transition-colors"
            aria-label={`View posts tagged ${t}`}
          >
            {t} <span className="text-[13px]">({tagCounts[t]})</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
