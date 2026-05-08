'use client'

import { usePathname } from 'next/navigation'
import { slug } from 'github-slugger'
import { formatDate } from 'pliny/utils/formatDate'
import { CoreContent } from 'pliny/utils/contentlayer'
import type { Blog } from 'contentlayer/generated'
import Link from '@/components/Link'
import Tag from '@/components/Tag'
import siteMetadata from '@/data/siteMetadata'
import tagData from 'app/tag-data.json'

interface PaginationProps {
  totalPages: number
  currentPage: number
}
interface ListLayoutProps {
  posts: CoreContent<Blog>[]
  title: string
  initialDisplayPosts?: CoreContent<Blog>[]
  pagination?: PaginationProps
}

function Pagination({ totalPages, currentPage }: PaginationProps) {
  const pathname = usePathname()
  const basePath = pathname
    .replace(/^\//, '')
    .replace(/\/page\/\d+\/?$/, '')
    .replace(/\/$/, '')
  const prevPage = currentPage - 1 > 0
  const nextPage = currentPage + 1 <= totalPages

  return (
    <div className="flex items-center justify-between pt-8 pb-4">
      {prevPage ? (
        <Link
          href={currentPage - 1 === 1 ? `/${basePath}/` : `/${basePath}/page/${currentPage - 1}`}
          rel="prev"
          className="text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text text-sm transition-colors"
        >
          ← Previous
        </Link>
      ) : (
        <span className="text-muted/40 text-sm">← Previous</span>
      )}
      <span className="text-muted dark:text-dark-muted text-[13px]">
        {currentPage} of {totalPages}
      </span>
      {nextPage ? (
        <Link
          href={`/${basePath}/page/${currentPage + 1}`}
          rel="next"
          className="text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text text-sm transition-colors"
        >
          Next →
        </Link>
      ) : (
        <span className="text-muted/40 text-sm">Next →</span>
      )}
    </div>
  )
}

export default function ListLayoutWithTags({
  posts,
  title,
  initialDisplayPosts = [],
  pagination,
}: ListLayoutProps) {
  const pathname = usePathname()
  const tagCounts = tagData as Record<string, number>
  const tagKeys = Object.keys(tagCounts)
  const sortedTags = tagKeys.sort((a, b) => tagCounts[b] - tagCounts[a])

  const displayPosts = initialDisplayPosts.length > 0 ? initialDisplayPosts : posts

  return (
    <div>
      <div className="pt-8 pb-4">
        <h1 className="text-charcoal dark:text-dark-text font-serif text-[clamp(2rem,4vw,2.5rem)] font-normal tracking-tight">
          {title}
        </h1>
      </div>

      <div className="border-divider dark:border-dark-divider flex flex-wrap gap-2 border-b pb-6">
        <Link
          href="/blog"
          className={`text-[13px] transition-colors ${
            pathname.startsWith('/blog')
              ? 'text-charcoal dark:text-dark-text font-medium'
              : 'text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text'
          }`}
        >
          All
        </Link>
        {sortedTags.map((t) => (
          <Link
            key={t}
            href={`/tags/${slug(t)}`}
            className={`text-[13px] transition-colors ${
              decodeURI(pathname.split('/tags/')[1]) === slug(t)
                ? 'text-charcoal dark:text-dark-text font-medium'
                : 'text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text'
            }`}
            aria-label={`View posts tagged ${t}`}
          >
            {t} ({tagCounts[t]})
          </Link>
        ))}
      </div>

      <div>
        {displayPosts.map((post) => {
          const { path, date, title, summary, tags } = post
          return (
            <article
              key={path}
              className="border-divider dark:border-dark-divider border-b py-8 last:border-b-0"
            >
              <Link href={`/${path}`} className="group block">
                <h2 className="text-charcoal dark:text-dark-text font-serif text-[clamp(1.25rem,2.5vw,1.5rem)] leading-[1.3] font-bold tracking-tight transition-opacity duration-200 group-hover:opacity-70">
                  {title}
                </h2>
              </Link>
              <div className="text-muted dark:text-dark-muted mt-1.5 text-[13px]">
                <time dateTime={date} suppressHydrationWarning>
                  {formatDate(date, siteMetadata.locale)}
                </time>
              </div>
              {summary && (
                <p className="text-book dark:text-dark-muted mt-2 line-clamp-2 text-sm leading-relaxed">
                  {summary}
                </p>
              )}
              {tags && tags.length > 0 && (
                <div className="mt-2.5 flex items-center gap-1">
                  {tags.map((tag, i) => (
                    <span key={tag} className="flex items-center gap-1">
                      {i > 0 && (
                        <span className="text-muted dark:text-dark-muted text-[13px]">·</span>
                      )}
                      <Tag text={tag} />
                    </span>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <Pagination currentPage={pagination.currentPage} totalPages={pagination.totalPages} />
      )}
    </div>
  )
}
