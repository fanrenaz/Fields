#!/bin/sh
set -eu

: "${FIELDS_RUSTFS_ROOT_ACCESS_KEY:?missing root access key}"
: "${FIELDS_RUSTFS_ROOT_SECRET_KEY:?missing root secret key}"
: "${FIELDS_COMPANY_FILES_ACCESS_KEY_ID:?missing Company Files access key}"
: "${FIELDS_COMPANY_FILES_SECRET_ACCESS_KEY:?missing Company Files secret key}"
: "${FIELDS_COMPANY_ASSETS_ACCESS_KEY_ID:?missing Company Assets access key}"
: "${FIELDS_COMPANY_ASSETS_SECRET_ACCESS_KEY:?missing Company Assets secret key}"

retry_budget_seconds="${FIELDS_RUSTFS_INIT_RETRY_BUDGET_SECONDS:-60}"
retry_delay_seconds="${FIELDS_RUSTFS_INIT_RETRY_DELAY_SECONDS:-2}"
case "${retry_budget_seconds}" in
  ''|*[!0-9]*)
    printf '%s\n' '{"stage":"object-storage-init","status":"failed","error":"retry budget must be a non-negative integer"}' >&2
    exit 1
    ;;
esac
case "${retry_delay_seconds}" in
  ''|*[!0-9]*)
    printf '%s\n' '{"stage":"object-storage-init","status":"failed","error":"retry delay must be a non-negative integer"}' >&2
    exit 1
    ;;
esac
retry_deadline=$(( $(date +%s) + retry_budget_seconds ))

redact_value() {
  redacted="$1"
  secret="$2"
  [ -n "${secret}" ] || {
    printf '%s' "${redacted}"
    return
  }
  while [ "${redacted#*"${secret}"}" != "${redacted}" ]; do
    prefix="${redacted%%"${secret}"*}"
    suffix="${redacted#*"${secret}"}"
    redacted="${prefix}[REDACTED]${suffix}"
  done
  printf '%s' "${redacted}"
}

safe_output() {
  sanitized="$1"
  for secret in \
    "${FIELDS_RUSTFS_ROOT_ACCESS_KEY}" \
    "${FIELDS_RUSTFS_ROOT_SECRET_KEY}" \
    "${FIELDS_COMPANY_FILES_ACCESS_KEY_ID}" \
    "${FIELDS_COMPANY_FILES_SECRET_ACCESS_KEY}" \
    "${FIELDS_COMPANY_ASSETS_ACCESS_KEY_ID}" \
    "${FIELDS_COMPANY_ASSETS_SECRET_ACCESS_KEY}"; do
    sanitized="$(redact_value "${sanitized}" "${secret}")"
  done
  printf '%s' "${sanitized}"
}

is_transient_readiness_error() {
  case "$1" in
    *[Ss]ervice\ not\ ready* \
      | *storage_quorum* \
      | *[Ii]nsufficient\ number\ of\ drives\ online* \
      | *[Ss]erver\ not\ initialized* \
      | *[Cc]onnection\ refused* \
      | *[Cc]onnection\ reset* \
      | *[Ii]/[Oo]\ timeout* \
      | *[Cc]ontext\ deadline\ exceeded* \
      | *[Tt]emporary\ failure\ in\ name\ resolution* \
      | *[Nn]o\ such\ host* \
      | *503\ [Ss]ervice\ unavailable*) return 0 ;;
    *) return 1 ;;
  esac
}

run_mc() {
  operation="$1"
  shift
  attempt=1
  while :; do
    if output="$(mc "$@" 2>&1)"; then
      return 0
    else
      status=$?
    fi

    if ! is_transient_readiness_error "${output}"; then
      safe_output "${output}" >&2
      printf '\n{"stage":"object-storage-init","status":"failed","operation":"%s","error":"non-transient mc failure"}\n' \
        "${operation}" >&2
      return "${status}"
    fi

    now="$(date +%s)"
    if [ "${now}" -ge "${retry_deadline}" ]; then
      safe_output "${output}" >&2
      printf '\n{"stage":"object-storage-init","status":"failed","operation":"%s","attempt":%s,"error":"retry budget exhausted"}\n' \
        "${operation}" "${attempt}" >&2
      return "${status}"
    fi

    printf '{"stage":"object-storage-init","status":"retrying","operation":"%s","attempt":%s}\n' \
      "${operation}" "${attempt}" >&2
    remaining=$((retry_deadline - now))
    delay="${retry_delay_seconds}"
    if [ "${delay}" -gt "${remaining}" ]; then
      delay="${remaining}"
    fi
    sleep "${delay}"
    attempt=$((attempt + 1))
  done
}

run_mc alias-set alias set fields http://rustfs:9000 \
  "${FIELDS_RUSTFS_ROOT_ACCESS_KEY}" \
  "${FIELDS_RUSTFS_ROOT_SECRET_KEY}"

run_mc create-company-files-bucket mb fields/fields-company-files --ignore-existing
run_mc create-company-assets-bucket mb fields/fields-company-assets --ignore-existing

run_mc create-company-files-policy admin policy create fields fields-company-files /policies/company-files-policy.json
run_mc create-company-assets-policy admin policy create fields fields-company-assets /policies/company-assets-policy.json

run_mc create-company-files-user admin user add fields \
  "${FIELDS_COMPANY_FILES_ACCESS_KEY_ID}" \
  "${FIELDS_COMPANY_FILES_SECRET_ACCESS_KEY}"
run_mc create-company-assets-user admin user add fields \
  "${FIELDS_COMPANY_ASSETS_ACCESS_KEY_ID}" \
  "${FIELDS_COMPANY_ASSETS_SECRET_ACCESS_KEY}"

run_mc attach-company-files-policy admin policy attach fields fields-company-files \
  --user "${FIELDS_COMPANY_FILES_ACCESS_KEY_ID}"
run_mc attach-company-assets-policy admin policy attach fields fields-company-assets \
  --user "${FIELDS_COMPANY_ASSETS_ACCESS_KEY_ID}"

run_mc disable-company-files-anonymous-access anonymous set none fields/fields-company-files
run_mc disable-company-assets-anonymous-access anonymous set none fields/fields-company-assets
