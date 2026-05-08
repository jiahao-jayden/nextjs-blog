import Image from './Image'
import Link from './Link'

const Card = ({ title, description, imgSrc, href }) => (
  <article className="border-divider dark:border-dark-divider border-b py-8 last:border-b-0">
    {imgSrc && (
      <div className="mb-4 overflow-hidden rounded">
        {href ? (
          <Link href={href} aria-label={`Link to ${title}`}>
            <Image
              alt={title}
              src={imgSrc}
              className="object-cover object-center"
              width={544}
              height={306}
            />
          </Link>
        ) : (
          <Image
            alt={title}
            src={imgSrc}
            className="object-cover object-center"
            width={544}
            height={306}
          />
        )}
      </div>
    )}
    <h2 className="text-charcoal dark:text-dark-text font-serif text-xl font-bold tracking-tight">
      {href ? (
        <Link
          href={href}
          aria-label={`Link to ${title}`}
          className="transition-opacity hover:opacity-70"
        >
          {title}
        </Link>
      ) : (
        title
      )}
    </h2>
    <p className="text-book dark:text-dark-muted mt-2 text-sm leading-relaxed">{description}</p>
    {href && (
      <Link
        href={href}
        className="text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text mt-3 inline-block text-[13px] transition-colors"
        aria-label={`Link to ${title}`}
      >
        View project →
      </Link>
    )}
  </article>
)

export default Card
