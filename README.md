# Payback

A Nimiq Mini App for splitting a bill and collecting NIM from each participant through the native Nimiq Pay approval dialog, with payment status read back from an independent on-chain confirmation check — never inferred from the wallet promise alone.

Built for Nimiq Mini Apps Cycle II. See `PRD.md`, `ARCHITECTURE.md`, `SECURITY.md`, `TESTING.md`, `DEMO.md`, `DECISIONS.md`, and `TASKS.md` for the full spec and build log.

## Development

```bash
npm install
npm run dev
```

Requires `.env.local` populated from `.env.example` (Convex deployment URL, app URL, Nimiq RPC endpoint/network).

## License

MIT — see [LICENSE](./LICENSE).
