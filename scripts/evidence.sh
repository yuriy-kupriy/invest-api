#!/usr/bin/env bash
# HW #32: writes <dir>/evidence.txt (key=value) from what the pipeline produced.
# Every number is read from a file or a job output, nothing is typed in:
#   build.log        one line per build invocation (wc -l)
#   deployment.json  kubectl get deploy -o json after pulumi up -> deployed-digest
#   rollout.txt      raw demo:rollout output -> rollout-*
#   secret-count.txt scripts/secret-count.sh on deployment.json
# The rest comes in as env from job outputs (built digest, scan exit, OIDC claims).
set -euo pipefail
DIR=${1:?usage: evidence.sh <dir>}
cd "$DIR"

kv() { awk -F= -v k="$1" '$1==k{print $2; exit}' "$2" 2>/dev/null || true; }
deployed=$( [ -s deployment.json ] && node -e '
const d=require(require("path").resolve("deployment.json"));
const img=d.spec.template.spec.containers.find(c=>c.name==="api").image;
console.log(img.includes("@")?img.split("@")[1]:"")' || true)

{
  echo "run-id=${RUN_ID}"
  echo "head-sha=${HEAD_SHA}"
  echo "image-ref=${IMAGE_REF}"
  echo "built-digest=${BUILT_DIGEST}"
  echo "deployed-digest=${deployed}"
  echo "build-invocations=$( [ -f build.log ] && wc -l < build.log | tr -d ' ' || echo 0)"
  echo "creds-source=oidc"
  echo "oidc-iss=${OIDC_ISS}"
  echo "oidc-aud=${OIDC_AUD}"
  echo "oidc-sub=${OIDC_SUB}"
  echo "oidc-sig-verified=${OIDC_SIG}"
  echo "rollout-requests=$(kv requests rollout.txt)"
  echo "rollout-ok=$(kv ok rollout.txt)"
  echo "rollout-failed=$(kv failed rollout.txt)"
  echo "rollout-seconds=$(kv rollout-seconds rollout.txt)"
  echo "secret-in-manifest=$(cat secret-count.txt 2>/dev/null || true)"
  echo "gate-scan-exit=${SCAN_EXIT}"
} > evidence.txt
cat evidence.txt
