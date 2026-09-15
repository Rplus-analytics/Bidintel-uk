#!/usr/bin/env bash
#
# Kept for muscle memory. Delegates to allow-ip.sh under the label "operator".
#
# The original version revoked EVERY CIDR ingress rule before adding its own,
# which quietly cut off any other tester. allow-ip.sh revokes only rules carrying
# the same label, and covers the PostgREST ALB as well as RDS.
set -euo pipefail
exec "$(dirname "$0")/allow-ip.sh" operator "$@"
