import Link from 'next/link'
import { slug } from 'github-slugger'

interface Props {
  text: string
  className?: string
}

const Tag = ({ text, className = '' }: Props) => {
  return (
    <Link
      href={`/tags/${slug(text)}`}
      className={`text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text text-[13px] transition-colors ${className}`}
    >
      {text}
    </Link>
  )
}

export default Tag
