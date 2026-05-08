'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { formatDate } from 'pliny/utils/formatDate'
import { CoreContent } from 'pliny/utils/contentlayer'
import type { Blog } from 'contentlayer/generated'
import Link from '@/components/Link'
import Tag from '@/components/Tag'
import siteMetadata from '@/data/siteMetadata'

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

export default function ListLayout({
  posts,
  title,
  initialDisplayPosts = [],
  pagination,
}: ListLayoutProps) {
  const [searchValue, setSearchValue] = useState('')
  const filteredBlogPosts = posts.filter((post) => {
    const searchContent = post.title + post.summary + post.tags?.join(' ')
    return searchContent.toLowerCase().includes(searchValue.toLowerCase())
  })

  const displayPosts =
    initialDisplayPosts.length > 0 && !searchValue ? initialDisplayPosts : filteredBlogPosts

  return (
    <div>
      <div className="pt-8 pb-6">
        <h1 className="text-charcoal dark:text-dark-text font-serif text-[clamp(2rem,4vw,2.5rem)] font-normal tracking-tight">
          {title}
        </h1>
        <div className="relative mt-6 max-w-md">
          <label>
            <span className="sr-only">Search articles</span>
            <input
              aria-label="Search articles"
              type="text"
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search articles"
              className="border-divider bg-vellum text-charcoal placeholder:text-muted focus:border-charcoal dark:border-dark-divider dark:bg-dark-surface dark:text-dark-text dark:placeholder:text-dark-muted dark:focus:border-dark-muted block w-full rounded-full border px-5 py-2.5 text-sm focus:outline-none"
            />
          </label>
          <svg
            className="text-muted dark:text-dark-muted absolute top-2.5 right-4 h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      <div className="border-divider dark:border-dark-divider border-t">
        {!filteredBlogPosts.length && (
          <p className="text-muted dark:text-dark-muted py-8 text-sm">No posts found.</p>
        )}
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
                <time dateTime={date}>{formatDate(date, siteMetadata.locale)}</time>
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

      {pagination && pagination.totalPages > 1 && !searchValue && (
        <Pagination currentPage={pagination.currentPage} totalPages={pagination.totalPages} />
      )}
    </div>
  )
}
