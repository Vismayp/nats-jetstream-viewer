# Security policy

Please report vulnerabilities privately through GitHub's **Security → Report a vulnerability** flow. Do not open a public issue containing credentials, decoder scripts, message payloads, internal NATS addresses, or exploit details.

## Deployment checklist

- Use a dedicated viewer NATS identity with only the documented read API subjects.
- Never grant `$JS.ACK.>`, consumer mutation, stream mutation, purge, or delete permissions.
- Generate unique high-entropy `NJV_MASTER_KEY`, `NJV_SESSION_SECRET`, and `NJV_ADMIN_PASSWORD` values.
- Keep `.env` out of source control and secrets out of container images.
- Terminate HTTPS before the application for every non-local deployment.
- Restrict network access to the UI and from the container to NATS.
- Back up the encrypted data volume and encryption key separately.
- Review custom decoder scripts before enabling them.
- Keep the container and NATS Server patched.

## Supported versions

Security fixes are applied to the latest release on the `main` branch.
