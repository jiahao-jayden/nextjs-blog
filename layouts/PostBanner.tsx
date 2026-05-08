import { ReactNode } from 'react'
import Image from '@/components/Image'
import Bleed from 'pliny/ui/Bleed'
import { CoreContent } from 'pliny/utils/contentlayer'
import type { Blog } from 'contentlayer/generated'
import Comments from '@/components/Comments'
import Link from '@/components/Link'
import PageTitle from '@/components/PageTitle'
import SectionContainer from '@/components/SectionContainer'
import siteMetadata from '@/data/siteMetadata'
import ScrollTopAndComment from '@/components/ScrollTopAndComment'

interface LayoutProps {
  content: CoreContent<Blog>
  children: ReactNode
  next?: { path: string; title: string }
  prev?: { path: string; title: string }
}

export default function PostMinimal({ content, next, prev, children }: LayoutProps) {
  const { slug, title, images } = content
  const displayImage =
    images && images.length > 0 ? images[0] : 'https://picsum.photos/seed/picsum/800/400'

  return (
    <SectionContainer>
      <ScrollTopAndComment />
      <article>
        <div className="pt-8">
          <div className="animate-fade-up w-full overflow-hidden rounded">
            <Bleed>
              <div className="relative aspect-2/1 w-full">
                <Image src={displayImage} alt={title} fill className="object-cover" />
              </div>
            </Bleed>
          </div>
          <div className="animate-fade-up animate-delay-1 mt-8">
            <PageTitle>{title}</PageTitle>
          </div>
          <div className="animate-fade-up animate-delay-2 prose dark:prose-invert mt-8 max-w-none [&>*]:max-w-[65ch]">
            {children}
          </div>
          {siteMetadata.comments && (
            <div
              className="border-divider dark:border-dark-divider border-t pt-8 pb-8"
              id="comment"
            >
              <Comments slug={slug} />
            </div>
          )}
          <footer className="border-divider dark:border-dark-divider border-t pt-6 pb-8">
            <div className="flex items-center justify-between text-sm">
              {prev && prev.path ? (
                <Link
                  href={`/${prev.path}`}
                  className="text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text transition-colors"
                  aria-label={`Previous post: ${prev.title}`}
                >
                  ← {prev.title}
                </Link>
              ) : (
                <span />
              )}
              {next && next.path ? (
                <Link
                  href={`/${next.path}`}
                  className="text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text transition-colors"
                  aria-label={`Next post: ${next.title}`}
                >
                  {next.title} →
                </Link>
              ) : (
                <span />
              )}
            </div>
          </footer>
        </div>
      </article>
    </SectionContainer>
  )
}
