# Time for Investment (TFI)

AI-Powered Investment Analysis Platform

## Project Structure

```
tfi/
├── index.html                  # Root entry point
├── README.md
├── uiweb.code-workspace
│
├── src/                        # Main source code
│   ├── app/                    # App shell & page entry
│   │   └── index.html          # Main app page (standalone version)
│   ├── components/             # UI components & rendering
│   │   ├── ui/                 # Reusable UI widgets (modals, toast, loader)
│   │   │   └── ui.js
│   │   ├── layout/             # Layout components (header, nav, tabs)
│   │   └── render.js           # DOM rendering (tables, pagination, selection)
│   ├── config/                 # Configuration & constants
│   │   ├── config.js           # Runtime config & utility helpers
│   │   └── constants.js        # Static data (leagues, tiers, statuses)
│   ├── lib/                    # Libraries & utilities
│   │   ├── services/           # API & business logic services
│   │   │   ├── api.js          # Backend API communication
│   │   │   └── auth.js         # Authentication service
│   │   └── utils/              # Shared utility functions
│   │       └── filters.js      # Data filtering & sorting
│   ├── hooks/                  # Custom hooks (future use)
│   └── types/                  # Type definitions (future use)
│
├── public/                     # Static assets
│   ├── css/
│   │   └── styles.css
│   └── images/
│
├── docs/                       # Documentation
│   └── standards/
│
├── scripts/                    # Build & utility scripts
│
├── tests/                      # Test files
│   └── test-api.html
│
└── legacy/                     # Previous code backup
    ├── apps/
    ├── js/
    └── css/
```

## Structure Mapping (aligned with Vocs pattern)

| Vocs Directory      | TFI Directory          | Purpose                        |
|---------------------|------------------------|--------------------------------|
| `src/app/`          | `src/app/`             | App entry & routing            |
| `src/components/ui/`| `src/components/ui/`   | Reusable UI widgets            |
| `src/components/layout/` | `src/components/layout/` | Layout components         |
| `src/config/`       | `src/config/`          | Configuration files            |
| `src/lib/`          | `src/lib/`             | Libraries & utilities          |
| `src/lib/services/` | `src/lib/services/`    | Backend service layer          |
| `src/hooks/`        | `src/hooks/`           | Custom hooks                   |
| `src/types/`        | `src/types/`           | Type definitions               |
| `public/`           | `public/`              | Static assets                  |
| `docs/`             | `docs/`                | Documentation                  |
| `scripts/`          | `scripts/`             | Build/utility scripts          |
| `tests/`            | `tests/`               | Test files                     |
