# AI Agent Guidelines for Algobot Development

This file contains rules and protocols that all AI agents (Gemini, Opus, Minimax, Deepseek, etc.) should follow when working on the Algobot project.

## Versioning Protocol

**Rule:** When making changes that affect both frontend and backend (feature additions, API changes, schema updates), bump **both** version numbers with a **minor** increment. Use the npm scripts:

- `npm run version:ui:minor` (bumps frontend version in package.json)
- `npm run version:srv:minor` (bumps backend version in headless-server.ts)

Also update `expectedBackendVersion` in package.json to match the new backend version.

For bug fixes that only affect one side (frontend or backend), use **patch** increments on the affected side only, assuming compatibility is maintained. If a fix breaks the other side, treat it as a feature change and bump both.

**Current Versions (as of April 2026):**

- Frontend: 1.10.1 (package.json)
- Backend: 1.9.1 (headless-server.ts)
- Expected Backend: 1.9.1 (package.json)

## Project Architecture Reference

For detailed system architecture and deployment procedures, refer to [BOT_ARCHITECTURE.md](./BOT_ARCHITECTURE.md).

## Agent-Specific Instructions

- **Gemini**: See [gemini.md](./gemini.md) for model-specific efficiency protocols
- **Other agents**: Adapt general guidelines as appropriate for your model capabilities

## General Development Rules

1. **Backend Deployment**: The backend runs on a remote Ubuntu server (`192.168.10.42`). After modifying backend files (`bot.ts`, `db.ts`, `headless-server.ts`), deploy using the SCP/PM2 procedure documented in BOT_ARCHITECTURE.md.

2. **Type Safety**: Always run `npm run typecheck` before deployment to ensure TypeScript compatibility.

3. **Live Trading Caution**: Do NOT edit the backend process while the PM2 engine is active doing live trades without clearing the event queue. If a patch fails compilation, it will cause an `EADDRINUSE` crash on Port 3030.

4. **Post-Change Cleanup Protocol**: After changes have been confirmed working without issue:
   - Commit all uncommitted and/or changed files to git with a descriptive commit message
   - If connected to GitHub, push the changes to the remote repository
   - Remove any temporary files created during development
   - For reusable tools or scripts, add them to the `scripts/` folder or other appropriate tool folders
   - Ensure no development artifacts remain in the codebase
