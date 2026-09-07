import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ImageResponse } from "next/og"
import { allBlogs } from "contentlayer/generated"

const size = {
  width: 1200,
  height: 630,
}

export const runtime = "nodejs"

const font = readFile(join(process.cwd(), "public/static/fonts/NotoSansKR-Regular.otf"))

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const slug = decodeURI((await params).slug.join("/"))
  const post = allBlogs.find((item) => item.slug === slug)
  const title = truncate(post?.title || "Jayden0", 34)
  const summary = truncate(post?.summary || "Notes on code, design, and AI systems.", 72)
  const tags = post?.tags?.slice(0, 3).join("  /  ") || "notes"
  const publishedAt = post?.date?.slice(0, 10).replaceAll("-", ".") || "jayden0.com"

  const response = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "64px 72px 58px",
        backgroundColor: "#f7f4ed",
        color: "#191919",
        fontFamily: "Noto Sans KR",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: 24 }}>
        <div style={{ width: "16px", height: "16px", backgroundColor: "#191919" }} />
        <span style={{ letterSpacing: "2px" }}>JAYDEN0.COM</span>
        <span style={{ color: "#63707a" }}>FIELD NOTES</span>
      </div>

      <div
        style={{ width: "100%", height: "2px", marginTop: "30px", backgroundColor: "#d5d1c8" }}
      />

      <div
        style={{
          display: "flex",
          maxWidth: "980px",
          marginTop: "46px",
          fontSize: 58,
          lineHeight: 1.28,
          letterSpacing: "0px",
        }}
      >
        {title}
      </div>

      <div
        style={{
          display: "flex",
          maxWidth: "920px",
          marginTop: "22px",
          fontSize: 25,
          lineHeight: 1.5,
          color: "#52616c",
        }}
      >
        {summary}
      </div>

      <div style={{ display: "flex", flex: 1 }} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "#63707a",
          fontSize: 22,
        }}
      >
        <span>{tags}</span>
        <span>{publishedAt}</span>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Noto Sans KR",
          data: await font,
          style: "normal",
          weight: 400,
        },
      ],
    }
  )

  response.headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
  return response
}
