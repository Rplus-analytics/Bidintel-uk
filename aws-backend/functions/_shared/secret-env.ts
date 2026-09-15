// ============================================================================
// Lazy Secrets Manager -> process.env loader
// ============================================================================
//
// WHY THIS EXISTS: the obvious way to give a Lambda an API key is a plain
// environment variable. That would put the key into Terraform state, into
// `aws lambda get-function-configuration` output, and into every CloudFormation
// -style drift diff — in plaintext, forever, readable by anyone with
// lambda:GetFunction. Instead Terraform sets only an *ARN*, and the value is
// fetched on the first invocation of each execution environment.
//
// The cost is one Secrets Manager call per cold start (~30ms, $0.05/10k). The
// promise — not the value — is cached at module scope, so concurrent calls
// inside one container share a single fetch and warm invocations pay nothing.
//
// The loaded value is deliberately NEVER logged, and errors quote the ARN
// rather than the payload.

const inflight = new Map<string, Promise<void>>();

/**
 * Ensure `process.env[envVar]` is populated, fetching it from the secret named
 * by `process.env[arnVar]` if it is not already set.
 *
 * A directly-set `envVar` always wins, so local development can export the key
 * and skip Secrets Manager entirely.
 *
 * @param envVar  e.g. "OPENAI_API_KEY" — also the JSON key looked up inside the
 *                secret, since the secrets are stored as {"OPENAI_API_KEY":"..."}
 * @param arnVar  e.g. "OPENAI_SECRET_ARN"
 */
export function ensureSecretEnv(envVar: string, arnVar: string): Promise<void> {
  if (process.env[envVar]) return Promise.resolve();

  const arn = process.env[arnVar];
  if (!arn) return Promise.resolve(); // caller reports the missing key its own way

  let p = inflight.get(envVar);
  if (p) return p;

  p = (async () => {
    const { SecretsManagerClient, GetSecretValueCommand } =
      await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({});
    const res = await sm.send(new GetSecretValueCommand({ SecretId: arn }));

    const raw = res.SecretString ?? "";
    let value: string | undefined;
    try {
      // Stored as JSON ({"OPENAI_API_KEY":"sk-..."}) by convention.
      const parsed = JSON.parse(raw);
      value = typeof parsed === "string" ? parsed : parsed?.[envVar];
    } catch {
      // A bare string secret is also accepted.
      value = raw || undefined;
    }

    if (!value) {
      // Names the ARN and the key it looked for, never the payload.
      throw new Error(`Secret ${arn} has no "${envVar}" value`);
    }
    process.env[envVar] = value;
  })();

  // A failed fetch must not poison the container: drop the cached rejection so
  // the next invocation retries (a transient Secrets Manager throttle would
  // otherwise brick the execution environment for its whole lifetime).
  p.catch(() => inflight.delete(envVar));

  inflight.set(envVar, p);
  return p;
}
