# Time for Investment (TFI)

AI-Powered Investment Analysis Platform

## Project Structure

```
tfi/
├── index.html                  # Vite HTML entry point
├── README.md
├── uiweb.code-workspace
│
├── src/                        # Frontend React/Vite application
│   ├── app/                    # Top-level tabs, shells, screens
│   ├── components/             # Shared UI and panels
│   ├── features/               # Feature modules (live monitor, etc.)
│   ├── hooks/                  # Frontend hooks
│   ├── lib/                    # Frontend services and utilities
│   └── types/                  # Frontend shared types
│
├── packages/
│   └── server/                 # Fastify + PostgreSQL backend
│
├── public/                     # Static assets
│   └── images/
│
├── docs/                       # Documentation
├── scripts/                    # Utility scripts
├── tests/                      # Test suites and fixtures
├── e2e/                        # End-to-end coverage
│
└── legacy/                     # Archived pre-React frontend source kept for reference
    ├── js/
    └── css/
```

## Notes

- The active frontend boot path is root `index.html` loading `/src/main.tsx`.
- `src/app/index.html` is no longer part of the runtime and has been removed.
- `legacy/` is intentionally excluded from normal test discovery and current app build paths.
- Nested `legacy/apps/web` snapshots are not part of the active runtime.
