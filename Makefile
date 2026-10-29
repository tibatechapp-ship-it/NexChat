# Rasan — unified dev commands
#
# The web client (vitest) and the server (node) live in one repo; these
# targets give every contributor — and every CI workflow — one entrypoint.

.PHONY: help install test lint verify clean

help:
	@echo "rasan — available targets:"
	@echo ""
	@echo "  make install   — install web + server dependencies"
	@echo "  make test      — vitest suite (same as CI gate)"
	@echo "  make lint      — node --check on web sources"
	@echo "  make verify    — lint + tests (the single 'green' definition)"
	@echo "  make clean     — remove coverage output"

install:
	npm install
	cd server && npm install

test:
	npm test

lint:
	npm run lint

verify:
	npm run verify

clean:
	rm -rf coverage .nyc_output
