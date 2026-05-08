---
name: Jayden's Blog
description: Digital Vellum — turning screens into considered paper.
colors:
  vellum-warm: "#f7f4ed"
  charcoal-ink: "#191919"
  inkwell-body: "#242424"
  book-gray: "#333333"
  muted-caption: "#6b6b6b"
  divider-faint: "#e8e4dc"
  dark-surface: "#1a1a1a"
  dark-muted: "#999999"
  dark-accent-gold: "#c4956a"
typography:
  display:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "clamp(2.25rem, 5vw, 3.5rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Lora, Georgia, serif"
    fontSize: "clamp(1.5rem, 3vw, 1.75rem)"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  pill: "999px"
  sm: "4px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "48px"
  xl: "64px"
components:
  button-subscribe:
    backgroundColor: "{colors.charcoal-ink}"
    textColor: "{colors.vellum-warm}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
  button-subscribe-hover:
    backgroundColor: "{colors.book-gray}"
    textColor: "{colors.vellum-warm}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
---

# Design System: Jayden's Blog

## 1. Overview

**Creative North Star: "Digital Vellum"**

The screen becomes a sheet of considered paper. Every choice serves a single premise: the words are the design. Typography carries the hierarchy, whitespace carries the rhythm, and warmth carries the invitation. The surface is not white — it is vellum, parchment, the off-white of a page you want to keep reading.

This system rejects corporate coldness, information overload, SaaS templates, and zero-personality defaults. It takes its cues from Medium's reading experience — the warmth, the generous spacing, the confidence that content alone is enough — while maintaining a distinct voice through considered serif typography and restraint that goes further than Medium itself.

**Key Characteristics:**
- Warm, papery canvas that separates this from every cold-white tech blog
- Serif display type for gravitas; sans-serif body for readability
- Extreme restraint in color — black, warm grays, and the vellum itself are the entire palette
- Pill-shaped CTAs as the single UI flourish
- Content density is low; every element has room to breathe

## 2. Colors

A deliberately monochromatic system. Color is not a tool here; typography and space do all the work. The warmth comes from the background, not from accent hues.

### Primary

- **Charcoal Ink** (#191919): Headlines, primary CTAs, the strongest visual mark on any page. Used for text that must command attention and filled button backgrounds.

### Neutral

- **Vellum Warm** (#f7f4ed): The defining surface. Every page rests on this warm off-white. It is NOT white; the yellow-warm undertone is the identity.
- **Inkwell Body** (#242424): Standard body text. Slightly softer than charcoal for comfortable long-form reading.
- **Book Gray** (#333333): Secondary body text, borders, and supporting content.
- **Muted Caption** (#6b6b6b): Dates, reading time, tags, and all tertiary information. Visible but never competing.
- **Divider Faint** (#e8e4dc): Separators between posts. Barely there — a whisper, not a shout.

### Dark Mode Neutrals

- **Dark Surface** (#1a1a1a): Warm near-black with no blue tint. The dark mode canvas.
- **Dark Muted** (#999999): Body text in dark mode.
- **Dark Accent Gold** (#c4956a): The only moment of color in dark mode — used exclusively on hover states to reward interaction.

### Named Rules

**The No-Color Rule.** This system has no accent color in light mode. Black is the accent. The warmth of the vellum background is the only "color" the reader perceives. If you reach for a blue, green, or any saturated hue in light mode, you are breaking the system.

## 3. Typography

**Display Font:** Lora (with Georgia, serif fallback)
**Body Font:** Inter (with system-ui, sans-serif fallback)

**Character:** Lora provides modern editorial gravitas — warm, bracketed serifs with sufficient x-height for screens. It reads as contemporary, not archival. Inter handles everything else with invisible competence. The pairing creates a single moment of contrast: display vs. body. Nothing else.

### Hierarchy

- **Display** (400, clamp(2.25rem, 5vw, 3.5rem), line-height 1.15): Page hero headlines only. The largest text on any page. Lora at normal weight with tight tracking (-0.02em). Used once per page, maximum.
- **Headline** (700, clamp(1.5rem, 3vw, 1.75rem), line-height 1.3): Blog post titles in listings. Bold Lora with slight negative tracking (-0.01em). The workhorse heading level.
- **Body** (400, 16px, line-height 1.6): Long-form reading. Inter at a comfortable size. Max line-length capped at 65ch.
- **Label** (400, 13px, line-height 1.4, tracking +0.01em): Dates, reading times, tags, metadata. Always in Muted Caption color. Never bold.

### Named Rules

**The Two-Font Rule.** Lora and Inter. There is no third font. No monospace for dates. No decorative font for anything. Two families, deployed at different scales, is the entire typographic system.

## 4. Elevation

This system is flat. There are no shadows. Depth is conveyed through typography scale and color value (darker = more prominent). Cards do not exist. Surfaces do not float. Content sits directly on the vellum.

### Named Rules

**The No-Shadow Rule.** If you add a box-shadow to any element, you are breaking the system. Elevation is expressed through typographic weight, size, and color contrast — never through z-axis simulation.

## 5. Components

### Buttons

- **Shape:** Full pill (border-radius 999px)
- **Primary (Subscribe):** Filled charcoal ink (#191919), vellum text (#f7f4ed), padding 8px 20px. Font: Inter 14px weight 500.
- **Hover:** Background shifts to book-gray (#333333). Transition: background 200ms ease-out.
- **Dark mode:** Outlined — 1px border in #444, text in off-white. Hover fills with dark-accent-gold.
- **No other button variants.** If it's not important enough for a pill button, it's a text link.

### Navigation

- **Style:** Horizontal, right-aligned text links. Inter 14px weight 400, inkwell body color.
- **Active state:** No underline, no color change. The current page link gets font-weight 500.
- **Hover:** Color shifts to charcoal ink (#191919). No underline animation.
- **Mobile:** Slide-in panel, same typography, stacked vertically with 48px tap targets.

### Post Cards (Post List Items)

- **No borders, no shadows, no background difference.** A post is just its content.
- **Title:** Headline-level Lora serif, charcoal ink color. On hover: subtle opacity shift to 0.7 (not a color change).
- **Meta row:** Label-level Inter. Avatar circle (24px) + "5 min read" in muted caption.
- **Summary:** Body-level Inter, 2-3 lines, book-gray color. Truncated with line-clamp.
- **Tags:** Label-level, muted caption color, dot-separated plain text. No pills, no borders, no backgrounds.
- **Separation:** 48px vertical whitespace between posts. Optional: 1px divider in divider-faint.

### Newsletter Input

- **Style:** Single-line text input + pill button side-by-side.
- **Input:** Border 1px book-gray, border-radius 999px (matching button), padding 10px 20px, vellum background.
- **Focus:** Border shifts to charcoal ink. No glow, no shadow.
- **Button:** Primary pill button style, attached to the right.

## 6. Do's and Don'ts

### Do:

- **Do** use Vellum Warm (#f7f4ed) as the page background on every single page. It is not optional.
- **Do** cap body text at 65ch line-length maximum. The reading experience breaks above this.
- **Do** use 48px+ spacing between post items. Generous whitespace is the luxury.
- **Do** keep tag/metadata styling at 13px muted gray with no visual embellishment.
- **Do** use Lora only for display and headline levels. Inter handles everything else.
- **Do** make the entire post card a click target (not a "Read more" link).
- **Do** test dark mode with the warm near-black (#1a1a1a), never with blue-black or pure black.

### Don't:

- **Don't** use pure white (#ffffff) as a page background. The vellum warmth is the identity.
- **Don't** add any saturated accent color in light mode. Black is the accent. (Violating PRODUCT.md: "anti-references: SaaS template with gradients")
- **Don't** use card borders, card shadows, or card backgrounds for post listings. (Violating PRODUCT.md: "anti-references: generic SaaS template look")
- **Don't** add tag pills with backgrounds or borders. Tags are plain text, always.
- **Don't** use more than two font families. (Violating PRODUCT.md: "anti-references: cluttered, information overload")
- **Don't** add a "Read more →" link to post cards. The card itself is the link.
- **Don't** use dividers heavier than 1px or darker than #e8e4dc. Separators whisper.
- **Don't** make the site feel like a template. (Violating PRODUCT.md: "anti-references: boring default, zero personality")
- **Don't** use border-left accents, gradient text, or glassmorphism anywhere.
