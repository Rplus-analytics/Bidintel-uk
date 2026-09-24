# Adapter live test

Exercises `_shared/sql-builder.ts` against the real `bidintel` database using the
exact call shapes the sixteen workers use. Read-only except for one row in
`buyers` that it creates and deletes.

```bash
export AWS_PROFILE=bidintel-deploy AWS_REGION=eu-north-1
export DATABASE_SECRET_ARN=$(aws secretsmanager describe-secret \
  --secret-id bidintel/worker-db --query ARN --output text)
npx tsx test/adapter-live.ts
```

It needs the operator IP allowlisted (`scripts/allow-ip.sh operator`).

Two of the bugs it caught would not have failed a typecheck or a unit test:
the missing `EXECUTE` grant on all fourteen trigger functions, and `.eq()`
throwing synchronously out of a chain that call sites never wrap in try/catch.
