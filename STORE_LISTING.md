# Chrome Web Store Listing Draft

## Name

Auto Dark Mode Switch

## Category

Accessibility

## Summary

Uses native dark mode when a site supports it, then falls back to Chrome Auto Dark Mode for light pages.

## Detailed Description

Auto Dark Mode Switch makes light websites easier to read without replacing a site's own dark theme.

When you open a light page, the extension first asks the site to use its native `prefers-color-scheme: dark` styles. If the page still appears light, it turns on Chrome Auto Dark Mode for that tab.

The popup stays simple:

- Auto: use native dark mode first, then Chrome Auto Dark Mode.
- Native: request only the site's native dark mode.
- Force: turn on Chrome Auto Dark Mode directly.
- Off: disable the extension for the current site.

The extension is local-only. It does not send browsing data, page content, analytics, identifiers, or settings anywhere.

## Single Purpose

Automatically make light websites dark by preferring native dark mode support and falling back to Chrome Auto Dark Mode when needed.

## Permission Justifications

- `debugger`: required to call Chrome DevTools Protocol dark-mode emulation commands for the active tab.
- `scripting`: required to sample page colors locally and inject the detector into tabs that were open before installation.
- `storage`: required to save the global setting and per-site mode.
- `tabs`: required to identify the active tab and respond to page navigation.
- `http://*/*`, `https://*/*`: required to detect and apply dark mode on normal websites.

## Privacy Practices

This extension does not collect or transmit user data. Page color checks happen locally in Chrome. Per-site settings are stored locally with `chrome.storage.local`.

Privacy policy URL after GitHub publication:

`https://github.com/studio-glhf/auto-dark-mode/blob/main/PRIVACY.md`

## Reviewer Test Instructions

1. Load the extension.
2. Open `https://example.com`; the popup should show `Auto dark`.
3. Open a page that supports `prefers-color-scheme: dark`; the popup should show `Native dark`.
4. Open an already dark page; the popup should show `Not needed`.
5. Use the popup to switch the current site between `Auto`, `Native`, `Force`, and `Off`.

