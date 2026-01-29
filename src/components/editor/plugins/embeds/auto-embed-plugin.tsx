import type { ReactElement } from "react"

/**
 * Stub for auto-embed plugin. Add full implementation later if needed.
 */
export type CustomEmbedConfig = {
  type: string
  contentName: string
  icon: ReactElement
  keywords: string[]
}

const stubIcon = <span aria-hidden />

export const EmbedConfigs: CustomEmbedConfig[] = [
  { type: "tweet", contentName: "Tweet", icon: stubIcon, keywords: ["twitter", "tweet"] },
  { type: "youtube-video", contentName: "YouTube", icon: stubIcon, keywords: ["youtube", "video"] },
]
