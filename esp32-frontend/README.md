# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Setup on Windows

Use Node.js 20.19+ or 22.12+. In PowerShell, use `npm.cmd` if the execution
policy blocks `npm.ps1`:

```powershell
npm.cmd install
npm.cmd run dev
```

Rollup uses its official WebAssembly build so the toolchain does not need the
native `.node` add-on blocked by Windows Application Control on some machines.

The dashboard checks `http://localhost:3000/api/telemetry` every two seconds.
The backend stores MQTT readings in `data/telemetry.jsonl`; the frontend only
loads and displays the ten newest readings. Use **Download Excel** to export
all readings saved by the backend as an unformatted `.xlsx` file with their
raw values.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
