#!/usr/bin/env bash
# Reproducibly prepares the GPL-2.0-or-later strongSwan Android engine and its
# OpenSSL dependency.  Generated native objects stay outside version control.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STRONGSWAN_DIR="${STRONGSWAN_DIR:-${ROOT_DIR}/native/vendor/strongswan}"
DEPS_DIR="${MIKROLINK_NATIVE_DEPS:-${ROOT_DIR}/.native-deps}"
OPENSSL_DIR="${OPENSSL_SRC:-${DEPS_DIR}/openssl}"

STRONGSWAN_COMMIT="eab0c41968e18e78e9598596827bf1ce910658ca"
OPENSSL_TAG="openssl-3.5.9"
OPENSSL_COMMIT="45e844fa2a14ec92d146bd8f5778ac130b6625fb"
ABIS="${ABIS:-armeabi-v7a arm64-v8a x86 x86_64}"

: "${ANDROID_NDK_ROOT:?ANDROID_NDK_ROOT must point to Android NDK 27.3.13750724}"

mkdir -p "$(dirname "${STRONGSWAN_DIR}")" "${DEPS_DIR}"

strongswan_fresh=0
if [[ ! -d "${STRONGSWAN_DIR}/.git" ]]; then
    if [[ -e "${STRONGSWAN_DIR}" ]]; then
        echo "${STRONGSWAN_DIR} exists but is not a Git checkout" >&2
        exit 1
    fi
    git clone --filter=blob:none --no-checkout \
        https://github.com/strongswan/strongswan.git "${STRONGSWAN_DIR}"
    strongswan_fresh=1
fi

if [[ "${strongswan_fresh}" == "0" ]] && { ! git -C "${STRONGSWAN_DIR}" diff --quiet || \
   ! git -C "${STRONGSWAN_DIR}" diff --cached --quiet; }; then
    echo "Refusing to overwrite local strongSwan changes" >&2
    exit 1
fi
git -C "${STRONGSWAN_DIR}" fetch --depth 1 origin "${STRONGSWAN_COMMIT}"
git -C "${STRONGSWAN_DIR}" checkout --detach "${STRONGSWAN_COMMIT}"

openssl_fresh=0
if [[ ! -d "${OPENSSL_DIR}/.git" ]]; then
    if [[ -e "${OPENSSL_DIR}" ]]; then
        echo "${OPENSSL_DIR} exists but is not a Git checkout" >&2
        exit 1
    fi
    git clone --filter=blob:none --no-checkout \
        https://github.com/openssl/openssl.git "${OPENSSL_DIR}"
    openssl_fresh=1
fi
if [[ "${openssl_fresh}" == "0" ]] && { ! git -C "${OPENSSL_DIR}" diff --quiet || \
   ! git -C "${OPENSSL_DIR}" diff --cached --quiet; }; then
    echo "Refusing to overwrite local OpenSSL changes" >&2
    exit 1
fi
git -C "${OPENSSL_DIR}" fetch --depth 1 origin "${OPENSSL_COMMIT}"
git -C "${OPENSSL_DIR}" checkout --detach "${OPENSSL_COMMIT}"
if [[ "$(git -C "${OPENSSL_DIR}" rev-parse HEAD)" != "${OPENSSL_COMMIT}" ]]; then
    echo "OpenSSL checkout must be exactly ${OPENSSL_TAG} (${OPENSSL_COMMIT})" >&2
    exit 1
fi

(
    cd "${STRONGSWAN_DIR}"
    ./autogen.sh
    ./configure
    make -j"$(nproc)"
    make distclean
)

OPENSSL_OUT="${STRONGSWAN_DIR}/src/frontends/android/app/src/main/jni/openssl"
if [[ ! -f "${OPENSSL_OUT}/Android.mk" ]] || \
   [[ ! -f "${OPENSSL_OUT}/arm64-v8a/libcrypto.a" ]] || \
   [[ ! -f "${OPENSSL_OUT}/armeabi-v7a/libcrypto.a" ]] || \
   [[ ! -f "${OPENSSL_OUT}/x86/libcrypto.a" ]] || \
   [[ ! -f "${OPENSSL_OUT}/x86_64/libcrypto.a" ]]; then
    NO_DOCKER=1 \
    ABIS="${ABIS}" \
    MIN_SDK=26 \
    ANDROID_NDK_ROOT="${ANDROID_NDK_ROOT}" \
    OPENSSL_SRC="${OPENSSL_DIR}" \
    OUT="${OPENSSL_OUT}" \
        "${STRONGSWAN_DIR}/src/frontends/android/openssl/build.sh"
fi

echo "strongSwan ${STRONGSWAN_COMMIT} and OpenSSL ${OPENSSL_TAG} are ready."
