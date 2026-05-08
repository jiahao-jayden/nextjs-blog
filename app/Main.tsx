import NewsletterForm from "pliny/ui/NewsletterForm";
import { formatDate } from "pliny/utils/formatDate";
import Link from "@/components/Link";
import Tag from "@/components/Tag";
import siteMetadata from "@/data/siteMetadata";

const MAX_DISPLAY = 5;

export default function Home({ posts }) {
	return (
		<>
			<div className="pt-12 pb-16">
				<h1 className="text-charcoal dark:text-dark-text font-serif text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.15] font-normal tracking-tight">
					{siteMetadata.description}
				</h1>
				<p className="text-muted dark:text-dark-muted mt-4 text-base">
					Written by {siteMetadata.author}
				</p>
			</div>

			<div>
				{!posts.length && (
					<p className="text-muted dark:text-dark-muted">No posts found.</p>
				)}
				{posts.slice(0, MAX_DISPLAY).map((post) => {
					const { slug, date, title, summary, tags } = post;
					return (
						<article
							key={slug}
							className="border-divider dark:border-dark-divider border-t py-10"
						>
							<Link href={`/blog/${slug}`} className="group block">
								<h2 className="text-charcoal dark:text-dark-text font-serif text-[clamp(1.5rem,3vw,1.75rem)] leading-[1.3] font-bold tracking-tight transition-opacity duration-200 group-hover:opacity-70">
									{title}
								</h2>
							</Link>
							<div className="text-muted dark:text-dark-muted mt-2 flex items-center gap-2 text-[13px]">
								<time dateTime={date}>
									{formatDate(date, siteMetadata.locale)}
								</time>
							</div>
							<p className="text-book dark:text-dark-muted mt-3 line-clamp-3 text-base leading-relaxed">
								{summary}
							</p>
							{tags && tags.length > 0 && (
								<div className="mt-3 flex items-center gap-1">
									{tags.map((tag, i) => (
										<span key={tag} className="flex items-center gap-1">
											{i > 0 && (
												<span className="text-muted dark:text-dark-muted text-[13px]">
													·
												</span>
											)}
											<Tag text={tag} />
										</span>
									))}
								</div>
							)}
						</article>
					);
				})}
			</div>

			{posts.length > MAX_DISPLAY && (
				<div className="border-divider dark:border-dark-divider border-t pt-8">
					<Link
						href="/blog"
						className="text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text text-sm transition-colors"
						aria-label="All posts"
					>
						All Posts →
					</Link>
				</div>
			)}

			{siteMetadata.newsletter?.provider && (
				<div className="border-divider dark:border-dark-divider mt-16 border-t pt-10">
					<NewsletterForm />
				</div>
			)}
		</>
	);
}
