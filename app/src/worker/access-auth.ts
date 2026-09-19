import { createRemoteJWKSet, type JWTVerifyOptions, jwtVerify } from "jose";

type AccessBindings = {
  AUTH_MODE?: string;
  ACCESS_JWT_AUD?: string;
  ACCESS_JWT_TEAM_DOMAIN?: string;
};

const accessJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticateAccessRequest(
  request: Request,
  environment: AccessBindings,
): Promise<Response | undefined> {
  if (environment.AUTH_MODE === "local") return undefined;

  if (environment.AUTH_MODE !== "production") {
    return authenticationConfigurationError();
  }

  const teamDomain = configuredTeamDomain(environment.ACCESS_JWT_TEAM_DOMAIN);
  const audience = environment.ACCESS_JWT_AUD;
  if (!teamDomain || !audience) return authenticationConfigurationError();

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return unauthenticated();

  try {
    const signingKeys = accessSigningKeys(teamDomain);
    const options: JWTVerifyOptions = {
      audience,
      issuer: teamDomain,
    };
    await jwtVerify(token, signingKeys, options);
  } catch {
    return unauthenticated();
  }

  return undefined;
}

function configuredTeamDomain(value: string | undefined) {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function accessSigningKeys(teamDomain: string) {
  const signingKeyUrl = `${teamDomain}/cdn-cgi/access/certs`;
  let signingKeys = accessJwks.get(signingKeyUrl);
  if (!signingKeys) {
    signingKeys = createRemoteJWKSet(new URL(signingKeyUrl));
    accessJwks.set(signingKeyUrl, signingKeys);
  }
  return signingKeys;
}

function unauthenticated() {
  return Response.json(
    {
      error: {
        code: "UNAUTHENTICATED",
        message: "A valid Cloudflare Access token is required.",
      },
    },
    { status: 401 },
  );
}

function authenticationConfigurationError() {
  return Response.json(
    {
      error: {
        code: "AUTH_CONFIGURATION_INVALID",
        message: "Cloudflare Access validation is not configured.",
      },
    },
    { status: 503 },
  );
}
