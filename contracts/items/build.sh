#!/bin/sh
# Build the items contract for NEAR. `--cfg near` makes near-sdk 5.27 report panic reasons on-chain
# (cargo-near 0.14, the last release for Rust 1.86, does not add it). `-s` strips the binary.
set -eu
cd "$(dirname "$0")"
RUSTFLAGS="-C link-arg=-s --cfg near" cargo build --target wasm32-unknown-unknown --release
mkdir -p target/near
cp target/wasm32-unknown-unknown/release/dragonlink_items.wasm target/near/dragonlink_items.wasm
echo "built target/near/dragonlink_items.wasm"
