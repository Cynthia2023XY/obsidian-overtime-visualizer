# Obsidian overtime visualizer

- Keep `src/main.ts` focused on plugin lifecycle and registration.
- Put UI modules in `src/ui`, Obsidian views in `src/views`, and shared types in `src/types`.
- Keep attendance data local. Do not add telemetry or network uploads.
- Every new function, variable, constant, type, interface, enum, computed value, ref, or watcher must have a Chinese `/** */` comment immediately before it.
- Use `npm`, TypeScript, and esbuild.
- Run `npm run test:run`, `npm run build`, and `npm run lint` before handoff.
