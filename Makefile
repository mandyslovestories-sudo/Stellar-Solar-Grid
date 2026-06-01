.PHONY: build test deploy

build:
	cd contracts && cargo build --target wasm32-unknown-unknown --release

test:
	cd contracts && cargo test

deploy:
	cd contracts && stellar contract deploy --wasm target/wasm32-unknown-unknown/release/solar_grid.wasm --network testnet
