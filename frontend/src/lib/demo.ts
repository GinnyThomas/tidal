// lib/demo.ts
//
// Purpose: Centralises the demo account credentials so they are defined in
//          one place only. Both the DemoButton component and any tests that
//          need to assert on the credentials can import from here.
//
// The demo account is seeded by backend/scripts/seed_demo.py.
// Credentials are not sensitive — they are intentionally public so that
// anyone visiting the site can try the app without registering.

export const DEMO_EMAIL = 'demo@tidal.app'
export const DEMO_PASSWORD = 'TidalDemo2026!'
