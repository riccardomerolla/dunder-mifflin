import { assert, describe, it } from "@effect/vitest"
import { oauthHeader, rfc3986, signatureBaseString, splitTweets } from "../src/XClient.ts"

describe("X client (pure OAuth 1.0a plumbing)", () => {
  it("percent-encodes per RFC 3986, not encodeURIComponent", () => {
    assert.strictEqual(rfc3986("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen")
    assert.strictEqual(rfc3986("An encoded string!"), "An%20encoded%20string%21")
    assert.strictEqual(rfc3986("Dogs, Cats & Mice"), "Dogs%2C%20Cats%20%26%20Mice")
    assert.strictEqual(rfc3986("☃"), "%E2%98%83")
    assert.strictEqual(rfc3986("safe-chars_~."), "safe-chars_~.")
  })

  it("assembles the signature base string exactly", () => {
    const base = signatureBaseString("POST", "https://api.x.com/2/tweets", {
      oauth_consumer_key: "key",
      oauth_nonce: "abc",
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: "1318622958",
      oauth_token: "token",
      oauth_version: "1.0"
    })
    assert.strictEqual(
      base,
      "POST&https%3A%2F%2Fapi.x.com%2F2%2Ftweets&" +
        "oauth_consumer_key%3Dkey%26oauth_nonce%3Dabc%26" +
        "oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26" +
        "oauth_token%3Dtoken%26oauth_version%3D1.0"
    )
  })

  it("builds an Authorization header carrying every oauth param and a base64 signature", () => {
    const header = oauthHeader(
      "POST",
      "https://api.x.com/2/tweets",
      {
        apiKey: "key",
        apiSecret: "csecret",
        accessToken: "token",
        accessSecret: "tsecret"
      },
      "fixed-nonce",
      1318622958
    )
    assert.isTrue(header.startsWith("OAuth "))
    assert.include(header, 'oauth_consumer_key="key"')
    assert.include(header, 'oauth_nonce="fixed-nonce"')
    assert.include(header, 'oauth_signature_method="HMAC-SHA1"')
    assert.include(header, 'oauth_timestamp="1318622958"')
    assert.include(header, 'oauth_token="token"')
    assert.include(header, 'oauth_version="1.0"')
    const signature = /oauth_signature="([^"]+)"/.exec(header)?.[1]
    assert.isString(signature)
    assert.match(decodeURIComponent(signature ?? ""), /^[A-Za-z0-9+/]+=*$/)
  })

  it("splits numbered threads and rejects oversize single tweets", () => {
    assert.deepStrictEqual(splitTweets("One short tweet."), ["One short tweet."])
    assert.deepStrictEqual(
      splitTweets("1/ First part.\n\n2/ Second part.\n\n3/ Third."),
      ["1/ First part.", "2/ Second part.", "3/ Third."]
    )
    assert.isUndefined(splitTweets("x".repeat(281)))
    assert.isUndefined(splitTweets(`1/ ok\n\n2/ ${"y".repeat(281)}`))
  })
})
