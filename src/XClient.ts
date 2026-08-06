import { createHmac, randomBytes } from "node:crypto"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ProcessError } from "@llm4ts/flow/FlowError"

// The X publisher's plumbing: OAuth 1.0a user-context signing (the
// classic four-credential setup from developer.x.com — no browser flow,
// no token refresh) and tweet posting via API v2. Pure signing helpers
// are exported for deterministic tests; only postTweet touches the
// network. Secrets arrive via env and never appear in errors or logs.

export interface XCredentials {
  readonly apiKey: string
  readonly apiSecret: string
  readonly accessToken: string
  readonly accessSecret: string
}

export const credentialsFromEnv = (
  env: Readonly<Record<string, string | undefined>>
): XCredentials | undefined => {
  const apiKey = env["DM_X_API_KEY"]
  const apiSecret = env["DM_X_API_SECRET"]
  const accessToken = env["DM_X_ACCESS_TOKEN"]
  const accessSecret = env["DM_X_ACCESS_SECRET"]
  return apiKey && apiSecret && accessToken && accessSecret
    ? { apiKey, apiSecret, accessToken, accessSecret }
    : undefined
}

// RFC 3986 percent-encoding: stricter than encodeURIComponent, which
// leaves !'()* unencoded and would break the signature.
export const rfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )

export const signatureBaseString = (
  method: string,
  url: string,
  params: Readonly<Record<string, string>>
): string => {
  const encoded = Object.entries(params)
    .map(([key, value]) => [rfc3986(key), rfc3986(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&")
  return `${method.toUpperCase()}&${rfc3986(url)}&${rfc3986(encoded)}`
}

export const oauthHeader = (
  method: string,
  url: string,
  credentials: XCredentials,
  nonce: string,
  timestampSeconds: number
): string => {
  const params: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestampSeconds),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0"
  }
  const signingKey = `${rfc3986(credentials.apiSecret)}&${rfc3986(credentials.accessSecret)}`
  const signature = createHmac("sha1", signingKey)
    .update(signatureBaseString(method, url, params))
    .digest("base64")
  const all = { ...params, oauth_signature: signature }
  return (
    "OAuth " +
    Object.entries(all)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${rfc3986(key)}="${rfc3986(value)}"`)
      .join(", ")
  )
}

const tweetLimit = 280

// X wraps every URL to a 23-character t.co link; length is judged as X
// judges it, not by raw characters.
const weightedLength = (text: string): number =>
  text.replace(/https?:\/\/[^\s]+/g, "x".repeat(23)).length

// A single tweet, or a numbered thread ("1/ ..." paragraphs). undefined
// when any segment exceeds the limit — Darryl reports instead of
// truncating someone's words.
export const splitTweets = (copy: string): ReadonlyArray<string> | undefined => {
  const trimmed = copy.trim()
  const segments = trimmed
    .split(/\n\s*\n(?=\d+\/)/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
  const tweets = segments.length > 1 || /^\d+\//.test(trimmed) ? segments : [trimmed]
  return tweets.every((tweet) => weightedLength(tweet) <= tweetLimit) ? tweets : undefined
}

const tweetResponse = Schema.Struct({
  data: Schema.Struct({ id: Schema.String })
})

const decodeTweetId = Schema.decodeUnknownEffect(tweetResponse)

const postOne = (
  credentials: XCredentials,
  text: string,
  replyToId: string | undefined
): Effect.Effect<string, ProcessError> =>
  Effect.gen(function* () {
    const url = "https://api.x.com/2/tweets"
    const nonce = randomBytes(16).toString("hex")
    const header = oauthHeader("POST", url, credentials, nonce, Math.floor(Date.now() / 1000))
    const body = JSON.stringify({
      text,
      ...(replyToId === undefined ? {} : { reply: { in_reply_to_tweet_id: replyToId } })
    })
    const response = yield* Effect.tryPromise({
      try: async () => {
        const result = await fetch(url, {
          method: "POST",
          headers: { Authorization: header, "Content-Type": "application/json" },
          body
        })
        const payload: unknown = await result.json().catch(() => undefined)
        return { status: result.status, payload }
      },
      catch: (error) =>
        ProcessError.make({ message: "x post tweet", detail: String(error) })
    })
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        ProcessError.make({
          message: "x post tweet",
          detail: `status ${response.status}: ${JSON.stringify(response.payload).slice(0, 300)}`
        })
      )
    }
    const decoded = yield* decodeTweetId(response.payload).pipe(
      Effect.mapError((error) =>
        ProcessError.make({ message: "x parse tweet response", detail: String(error) })
      )
    )
    return decoded.data.id
  })

// Post a tweet or thread; returns the first tweet's id (the shareable
// one). Thread segments chain as replies.
export const postThread = (
  credentials: XCredentials,
  tweets: ReadonlyArray<string>
): Effect.Effect<string, ProcessError> =>
  Effect.gen(function* () {
    let firstId: string | undefined
    let previousId: string | undefined
    for (const tweet of tweets) {
      const id = yield* postOne(credentials, tweet, previousId)
      firstId = firstId ?? id
      previousId = id
    }
    return firstId ?? ""
  })
