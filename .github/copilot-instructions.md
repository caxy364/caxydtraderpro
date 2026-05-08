# Deriv Bot Builder - AI Copilot Instructions

## Project Overview

**Deriv Bot Builder** (TICKSHARK) is a visual, block-based trading bot builder for Deriv's trading platform. Users create automated trading strategies using Blockly without writing code. The project uses **React 18 + TypeScript** with **MobX** state management and **RSBuild** for compilation.

**Key Architecture**: Centralized `RootStore` (MobX) manages all feature stores → React components observe store state → user actions trigger store mutations.

---

## Build & Development Commands

| Task | Command | Notes |
|------|---------|-------|
| **Dev Server** | `npm start` | Runs on port 3000; uses RSBuild with HMR |
| **Production Build** | `npm run build` | Outputs to `dist/` |
| **Build Watch** | `npm run watch` | Continuous incremental builds |
| **Tests** | `npm test` | Jest with React Testing Library |
| **Test Coverage** | `npm run coverage` | Generates coverage reports |
| **Linting** | `npm run test:lint` | Prettier + ESLint (writes fixes) |
| **Bundle Analysis** | `npm run build:analyze` | BUNDLE_ANALYZE=true rsbuild build |

**Node Version**: 18.x (enforce in new terminals)

---

## Architecture: MobX Stores & Components

### RootStore (src/stores/root-store.ts)
**Single source of truth** instantiated once per app session. Constructor wires all 21+ feature stores with dependency injection:

```typescript
export default class RootStore {
  app: AppStore;              // Core app lifecycle & settings
  summary_card: SummaryCardStore;  // Live contract info display
  run_panel: RunPanelStore;        // Bot execution control & stats
  transactions: TransactionsStore; // Historic bot contracts & profits
  blockly_store: BlocklyStore;     // Blockly editor state
  chart_store: ChartStore;         // Chart rendering & data
  quick_strategy: QuickStrategyStore;  // Pre-built strategy templates
  // ... 13 more stores (flyout, journal, toolbar, ui, client, etc.)
}
```

### Store Patterns

1. **Observable Properties** (MobX): Use `@observable` for mutable state; derive computed values with `@computed` getters
2. **Actions** (MobX): Use `@action` for state mutations; wrap in `makeObservable()` in constructor
3. **Reactions**: Use `reaction()` to watch observable changes and trigger side-effects (e.g., save to localStorage)
4. **Constructor Injection**: Stores receive `RootStore` + `TStores` (core deriv-com libs) for cross-store communication

**Example (TransactionsStore)**:
```typescript
export default class TransactionsStore {
  elements: TElement = getStoredItemsByUser(this.TRANSACTION_CACHE, ...);
  
  @observable active_transaction_id: number | null = null;
  
  @action pushTransaction(data: TContractInfo) { /* mutate state */ }
  @computed get transactions() { /* derive from elements */ }
}
```

### React Components → Stores

- **Functional Components** with `observer` HOC from `mobx-react-lite` to auto-subscribe to store changes
- Access stores via custom hook: `const { root_store, common, ui } = useStore();`
- **Path aliases** via tsconfig: `@/components`, `@/stores`, `@/hooks`, `@/utils`, `@/constants`
- Component files pair with `.scss` SCSS modules for scoped styling

**Common Component Dirs**:
- `shared_ui/` — Reusable low-level UI (Button, Dialog, Tabs, etc.)
- `layout/` — Page structure
- `shared/` — Utility functions & services (validators, date helpers, API calls)

---

## Styling: SCSS with Color Constants

All projects use **SCSS modules** with variables from `src/components/shared/styles/_constants.scss`:

- **Color naming**: `$color-{semantic}-{shade}` (e.g., `$color-red-1`, `$color-green-2`)
- **Responsive**: Use `DesktopWrapper` / `MobileWrapper` components or SCSS media queries
- **Class naming**: BEM-inspired (e.g., `.dc-contract-card__indicative--movement`)
- **Global styles**: `src/styles/` for app-wide resets; component-scoped SCSS otherwise

---

## Key Integration Points & Dependencies

### External APIs & Libraries

| Library | Purpose | Notes |
|---------|---------|-------|
| `@deriv-com/*` | Auth, translations, UI, utilities | Centralized Deriv ecosystem |
| `@deriv/deriv-api` | Deriv's trading WebSocket API | Core contract/market data |
| `@deriv/deriv-charts` | Smart Charts library | Copy dist files to `/assets` in build (see rsbuild.config.ts) |
| `blockly` | Visual block editor | Workspace in `BlocklyStore` |
| `mobx` / `mobx-react-lite` | State management | Used universally, no Redux |
| `react-router-dom` v6 | Routing | Routes: `/` (main), `/endpoint`, `/callback` |
| `framer-motion` | Animations | Smooth transitions |
| `@tanstack/react-query` | Data fetching | May be phased in; currently minimal use |

### XML & Contract Handling

- **Bot Strategy XML**: Serialized Blockly workspace → XML → API submission
- **Trading Contracts**: `ProposalOpenContract` types from `@deriv/api-types`
- **XML Helper**: [src/XmlHelper.ts](src/XmlHelper.ts) for parsing/generation
- **Raw loader** in rsbuild: `.xml` files → string imports

### Analytics & Monitoring

- **RudderStack**: Event tracking (custom events in `src/analytics/`)
- **Datadog**: Session replay & RUM
- **TrackJS**: Error tracking (initialized in ErrorBoundary)

---

## Common Workflows

### Adding a New Store Feature
1. Create `src/stores/my-feature-store.ts` with class extending MobX patterns
2. Import + instantiate in `RootStore` constructor
3. Add property: `public my_feature: MyFeatureStore;`
4. Use in components: `const { my_feature } = useStore();`

### Adding a UI Component
1. Create `src/components/my-component/my-component.tsx` (functional, with `observer` if store-dependent)
2. Pair with `src/components/my-component/my-component.scss` for styling
3. Export from parent `index.ts` if part of a feature group
4. Use path alias: `import MyComponent from '@/components/my-component';`

### Debugging Store State
- MobX DevTools (browser extension) shows observable mutations in real-time
- Add `console.log(toJS(store_name))` to print current state
- Check `jest.config.ts` for test configuration (jsdom environment, mocks)

---

## Testing Conventions

- **Jest + React Testing Library** (not Enzyme)
- **File naming**: `__tests__/component.spec.tsx` (placed in same directory as component)
- **Mocks**: Global mocks in `__mocks__/` (fileMock.js, styleMock.js, etc.)
- **Utilities**: `jest.setup.ts` includes localStorage mock
- **Test IDs**: Use `data-testid` for reliable element selection

**Example**:
```typescript
describe('<Endpoint />', () => {
  it('should render the endpoint component', () => {
    render(<Endpoint />);
    expect(screen.getByTestId('dt_endpoint_server_url_input')).toBeInTheDocument();
  });
});
```

---

## Project-Specific Patterns

### 1. Store Initialization Order Matters
In `RootStore` constructor, comment shows dependency: `// need to be at last for dependency` — `ChartStore` and `BlocklyStore` depend on other stores being ready first.

### 2. Shared Utilities (src/components/shared/)
Massive barrel-export index centralizes helpers:
- **Validators**: Contract, digital options, vanilla options
- **Date/Time**: Format, parse, convert
- **Array/Object**: Utilities for data manipulation
- **Services**: Lazy-loaded API wrappers

### 3. Error Handling
- **ErrorBoundary**: Class component catching render errors; logs to TrackJS
- **ErrorComponent**: UI page for user-facing errors
- **CommonStore** holds error state; ErrorComponentWrapper observes & displays

### 4. Lazy Loading & Code Splitting
- `React.lazy()` + `Suspense` for route-level pages
- `makeLazyLoader()` utility (in shared) for dynamic component imports with fallback loaders
- RSBuild auto-chunks; ChunkLoader displays while loading

### 5. XML-Based Strategy Storage
- Bot strategies serialized as XML (Blockly format) → stored in localStorage or DB
- Public pre-built bot XMLs in `public/*.xml`
- On load: fetch XML → deserialize → restore Blockly workspace state

---

## File Structure Quick Reference

```
src/
├── app/                    # Entry point, router, providers
├── components/
│   ├── shared/             # Utilities, validators, services (huge)
│   ├── shared_ui/          # Reusable UI components
│   ├── layout/             # Page containers
│   └── [feature]/          # Feature-specific (bot-notification, journal, etc.)
├── stores/                 # MobX stores (21+ files)
├── hooks/                  # Custom hooks (useStore, useDebounce, etc.)
├── pages/                  # Route pages (main, endpoint, callback)
├── types/                  # Global TypeScript types
├── constants/              # Constants, transaction types, etc.
├── utils/                  # App utilities (helpers, store-helpers)
├── styles/                 # Global SCSS
├── analytics/              # RudderStack event tracking
└── external/               # bot-skeleton (bot execution runtime)

public/
├── *.xml                   # Pre-built bot strategies
├── assets/                 # Images, fonts, videos
├── service-worker.js       # PWA support
└── [subdirs]/              # Signal analyzer, LDP tools
```

---

## Important Notes for AI Agents

1. **No Redux**: Project uses MobX exclusively; all state flows through `RootStore`
2. **Always use `observer`**: Wrap functional components that read observables
3. **Strict TypeScript**: `noUnusedLocals: true`, `noUnusedParameters: true` — remove dead code
4. **Alias paths**: Never use relative imports like `../../../`; use `@/`
5. **Test IDs**: Add `data-testid` attributes for testability
6. **SCSS constants**: Don't hardcode colors; use `_constants.scss` variables
7. **Store injection pattern**: Stores receive `RootStore` for cross-feature communication
8. **XML handling**: Blockly workspaces → XML → API contracts; XmlHelper.ts is key
9. **Localization**: All user strings use `localize()` from `@deriv-com/translations`
10. **Build output**: `dist/` directory; copy deriv-charts assets manually in rsbuild

---

## Quick Debugging Tips

- **Dev server won't start?** Check `npm run build` works first; verify node 18.x
- **Store changes not re-rendering?** Ensure component has `observer` HOC
- **SCSS not applying?** Verify import uses `.scss` extension; check className spelling
- **Type errors on Deriv API types?** Check `@deriv/api-types` version in package.json
- **XML parsing fails?** Review XmlHelper.ts for contract → XML serialization

---

**Last Updated**: January 2026 | **Version**: React 18 + MobX + RSBuild
