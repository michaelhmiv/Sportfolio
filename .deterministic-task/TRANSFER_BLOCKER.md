# Deterministic transfer blocker

The checksum-pinned implementation archive was independently recovered and verified:

- compressed size: `237968` bytes
- compressed SHA-256: `ca346b858d9001b2621ef02e6737858a428190e87027e6f35860501f200defce`
- decompressed patch SHA-256: `f5b70e4b6244f6885d6486ab39b52b0a58ae49dc3bb83354aa72c2e410c358e9`

Publication is blocked because the Drive object requires the connected user's authentication, while GitHub Actions remains queued without a runner. The authoritative PR must not be merged until its branch contains the implementation deletions and validation is rerun.

Resolution: grant anonymous read access to the Drive object or upload the exact archive to a public checksum-stable URL, then rerun the deterministic workflow.
