import { createExecutionContext, env } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "./index";

const accessTeamDomain = "https://team.cloudflareaccess.com";
const accessAudience = "taskseq-production";
const accessKeyId = "test-access-key";
let privateKey: CryptoKey;
let publicJwk: JsonWebKey;

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  publicJwk = await exportJWK(keyPair.publicKey);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cloudflare Access middleware", () => {
  it("rejects an API request that bypasses Cloudflare Access", async () => {
    const response = await fetchApi();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "A valid Cloudflare Access token is required.",
      },
    });
  });

  it("accepts a signed Access JWT for the configured audience", async () => {
    mockAccessSigningKeys();
    const response = await fetchApi(await signedAccessToken(accessAudience));

    expect(response.status).toBe(200);
  });

  it("rejects a signed Access JWT for another audience", async () => {
    mockAccessSigningKeys();
    const response = await fetchApi(
      await signedAccessToken("other-application"),
    );

    expect(response.status).toBe(401);
  });

  it("rejects a JWT with a tampered signature", async () => {
    mockAccessSigningKeys();
    const token = await signedAccessToken(accessAudience);
    const [header, payload, signature] = token.split(".");
    const replacement = signature?.startsWith("x") ? "y" : "x";
    const tamperedToken = `${header}.${payload}.${replacement}${signature?.slice(1)}`;

    const response = await fetchApi(tamperedToken);

    expect(response.status).toBe(401);
  });
});

function fetchApi(accessToken?: string) {
  const headers = new Headers();
  if (accessToken) headers.set("cf-access-jwt-assertion", accessToken);

  return worker.fetch(
    new Request("http://example.com/api/v1/health", { headers }),
    {
      DB: env.DB,
      AUTH_MODE: "production",
      ACCESS_JWT_AUD: accessAudience,
      ACCESS_JWT_TEAM_DOMAIN: accessTeamDomain,
    },
    createExecutionContext(),
  );
}

async function signedAccessToken(audience: string) {
  return new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: accessKeyId })
    .setIssuedAt()
    .setIssuer(accessTeamDomain)
    .setAudience(audience)
    .setExpirationTime("2h")
    .sign(privateKey);
}

function mockAccessSigningKeys() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input.toString());
    if (url.href === `${accessTeamDomain}/cdn-cgi/access/certs`) {
      return Response.json({
        keys: [{ ...publicJwk, alg: "RS256", kid: accessKeyId, use: "sig" }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}
