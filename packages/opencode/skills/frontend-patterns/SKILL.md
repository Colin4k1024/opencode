---
name: frontend-patterns
description: React and Next.js best practices for components, data flow, SSR, routing, and performance
---

# Frontend Patterns (React / Next.js)

## Components

- Prefer function components and hooks over classes
- Keep components small and single-purpose; extract when a component does more than one thing
- Colocate related logic (state, effects, handlers) with the component; move shared logic to hooks
- Use composition over prop drilling; consider context only when many levels need the same data

## Data flow

- Fetch at the level that needs the data; avoid over-fetching in a root and passing down
- Use server components (Next.js) where possible to move data fetching to the server
- Normalize client state; avoid duplicating the same entity in multiple places

## SSR and Next.js

- Use the App Router for new Next.js projects; prefer Server Components by default
- Put data fetching in async Server Components or in `getData`/server actions; avoid `useEffect` for initial load when SSR is available
- Use `loading.tsx` and `error.tsx` for streams and error boundaries

## Routing

- Use file-based routing; keep route segments shallow when possible
- Put layout in `layout.tsx` and page in `page.tsx`; share layout where it makes sense
- Use `generateMetadata` for dynamic meta; `generateStaticParams` for static segments

## Performance

- Lazy-load below-the-fold or route-level components with `next/dynamic` or `React.lazy`
- Optimize images with `next/image`; set `sizes` for responsive layouts
- Avoid large client bundles: use Server Components, tree-shake, and analyze with `@next/bundle-analyzer`
