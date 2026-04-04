/// <reference types="vite/client" />

// Extends Vite's built-in ImportMetaEnv interface to declare our custom
// environment variables. TypeScript will then know about VITE_API_URL
// throughout the codebase — including autocomplete and type checking.
//
// Any variable added to .env that the frontend reads should be declared here.
// Only VITE_-prefixed variables are exposed to client-side code by Vite.

interface ImportMetaEnv {
    readonly VITE_API_URL: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
