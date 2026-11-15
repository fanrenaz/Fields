#!/bin/sh
set -eu

: "${FIELDS_CONFIRM_RESET_COMPANY_ASSETS:?set to DELETE_ALL_COMPANY_ASSETS}"
: "${DATABASE_URL:?missing PostgreSQL connection string}"
: "${FIELDS_RUSTFS_ENDPOINT:?missing RustFS endpoint}"
: "${FIELDS_RUSTFS_ROOT_ACCESS_KEY:?missing RustFS root access key}"
: "${FIELDS_RUSTFS_ROOT_SECRET_KEY:?missing RustFS root secret key}"
: "${FIELDS_COMPANY_RUNTIME_WORKDIR:?missing Company Runtime workdir}"

if [ "${FIELDS_CONFIRM_RESET_COMPANY_ASSETS}" != "DELETE_ALL_COMPANY_ASSETS" ]; then
  echo "Refusing reset: confirmation value does not match." >&2
  exit 2
fi

assets_directory="${FIELDS_COMPANY_RUNTIME_WORKDIR%/}/assets"
case "${assets_directory}" in
  /assets|//assets|./assets)
    echo "Refusing reset: Company Runtime assets directory is too broad." >&2
    exit 2
    ;;
esac

mc alias set fields-reset \
  "${FIELDS_RUSTFS_ENDPOINT}" \
  "${FIELDS_RUSTFS_ROOT_ACCESS_KEY}" \
  "${FIELDS_RUSTFS_ROOT_SECRET_KEY}"
mc rm --recursive --force fields-reset/fields-company-assets

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
TRUNCATE TABLE
  asset_builder_topics,
  member_asset_operations,
  member_asset_installations,
  member_asset_profiles,
  company_asset_mutation_receipts,
  company_asset_version_credentials,
  company_asset_versions,
  company_asset_drafts,
  company_assets
CASCADE;
COMMIT;
SQL

rm -rf -- "${assets_directory}"
mkdir -p -- "${assets_directory}"
chmod 700 -- "${assets_directory}"
