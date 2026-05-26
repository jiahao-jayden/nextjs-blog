"use client"

import { FormEvent, useRef, useState } from "react"

type NewsletterFormProps = {
  title?: string
  apiUrl?: string
}

export default function NewsletterForm({
  title = "Subscribe to the newsletter",
  apiUrl = "/api/newsletter",
}: NewsletterFormProps) {
  const inputEl = useRef<HTMLInputElement>(null)
  const [error, setError] = useState(false)
  const [message, setMessage] = useState("")
  const [subscribed, setSubscribed] = useState(false)

  const subscribe = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const input = inputEl.current
    if (!input) return

    const email = input.value
    if (!email) return

    const response = await fetch(apiUrl, {
      body: JSON.stringify({ email }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
    const { error: responseError } = await response.json()

    if (responseError) {
      setError(true)
      setMessage("Your e-mail address is invalid or you are already subscribed.")
      return
    }

    input.value = ""
    setError(false)
    setSubscribed(true)
  }

  return (
    <section className="mx-auto w-full max-w-md sm:max-w-xl" aria-labelledby="newsletter-title">
      <h2
        id="newsletter-title"
        className="text-charcoal dark:text-dark-text font-sans text-xl leading-snug font-semibold tracking-tight"
      >
        {title}
      </h2>
      <form className="mt-3 grid w-full gap-3 sm:grid-cols-[1fr_auto]" onSubmit={subscribe}>
        <label htmlFor="email-input" className="block min-w-0">
          <span className="sr-only">Email address</span>
          <input
            autoComplete="email"
            className="border-book bg-vellum text-inkwell placeholder:text-muted focus:border-charcoal dark:border-dark-muted dark:bg-dark-surface dark:text-dark-text dark:placeholder:text-dark-muted h-12 w-full rounded-[4px] px-5 text-base transition-colors duration-200 focus:ring-0 focus:outline-none disabled:cursor-default disabled:opacity-70"
            id="email-input"
            name="email"
            placeholder={subscribed ? "You're subscribed" : "Enter your email"}
            ref={inputEl}
            required
            type="email"
            disabled={subscribed}
          />
        </label>
        <button
          className="bg-charcoal text-vellum hover:bg-book dark:border-dark-muted dark:text-dark-text dark:hover:bg-dark-gold h-12 rounded-[4px] px-7 text-base font-medium transition-colors duration-200 disabled:cursor-default sm:min-w-32 dark:border dark:bg-transparent"
          type="submit"
          disabled={subscribed}
        >
          {subscribed ? "Thank you!" : "Sign up"}
        </button>
      </form>
      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
          {message}
        </p>
      )}
    </section>
  )
}
