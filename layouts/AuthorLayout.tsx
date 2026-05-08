import { ReactNode } from 'react'
import type { Authors } from 'contentlayer/generated'
import SocialIcon from '@/components/social-icons'
import Image from '@/components/Image'

interface Props {
  children: ReactNode
  content: Omit<Authors, '_id' | '_raw' | 'body'>
}

export default function AuthorLayout({ children, content }: Props) {
  const { name, avatar, occupation, company, email, twitter, bluesky, linkedin, github } = content

  return (
    <div className="pt-10">
      <h1 className="text-charcoal dark:text-dark-text font-serif text-[clamp(2rem,4vw,2.5rem)] font-normal tracking-tight">
        About
      </h1>
      <div className="border-divider dark:border-dark-divider mt-10 border-t pt-10 sm:flex sm:gap-12">
        <div className="flex shrink-0 flex-col items-center sm:items-start">
          {avatar && (
            <Image
              src={avatar}
              alt="avatar"
              width={160}
              height={160}
              className="h-40 w-40 rounded-full"
            />
          )}
          <h3 className="text-charcoal dark:text-dark-text mt-4 font-serif text-xl font-bold">
            {name}
          </h3>
          {occupation && (
            <div className="text-muted dark:text-dark-muted mt-1 text-sm">{occupation}</div>
          )}
          {company && <div className="text-muted dark:text-dark-muted text-sm">{company}</div>}
          <div className="mt-4 flex gap-3">
            <SocialIcon kind="mail" href={`mailto:${email}`} />
            <SocialIcon kind="github" href={github} />
            <SocialIcon kind="linkedin" href={linkedin} />
            <SocialIcon kind="x" href={twitter} />
            <SocialIcon kind="bluesky" href={bluesky} />
          </div>
        </div>
        <div className="prose dark:prose-invert mt-8 max-w-none sm:mt-0">{children}</div>
      </div>
    </div>
  )
}
