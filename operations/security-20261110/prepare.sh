#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
sha256sum -c SHA256SUMS
# Never build the old fork at repository root. This directory must be new.
test ! -e candidate-source
git clone --no-checkout https://github.com/LibreSpark/LibreTV.git candidate-source
git -C candidate-source checkout --detach b08c8242d2a3cdb4309b40c58001c69c04593ce1
git -C candidate-source apply --check ../security.patch
git -C candidate-source apply ../security.patch
# Deliberately does not start/build a container or touch production configuration.
