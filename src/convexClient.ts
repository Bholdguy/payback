import { ConvexReactClient } from 'convex/react'

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined
if (!convexUrl) {
  throw new Error('VITE_CONVEX_URL is not set — see .env.example')
}

export const convex = new ConvexReactClient(convexUrl)
