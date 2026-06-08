# Auto Dark Mode Switch

Auto Dark Mode Switch is a Chrome extension that makes light pages dark with the least invasive path available:

1. It asks the page to use native dark mode with `prefers-color-scheme: dark`.
2. If the page stays light, it enables Chrome's Auto Dark Mode rendering for that tab.

The extension is local-only. It does not send browsing data, page content, analytics, or settings anywhere.

## Install Locally

1. Run `npm run make:icons`.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Choose **Load unpacked** and select this repository folder.

## Use

The toolbar popup has one global toggle and one current-site mode control:

- **Auto**: prefer native dark mode, then fall back to Chrome Auto Dark Mode.
- **Native**: request only `prefers-color-scheme: dark`.
- **Force**: use Chrome Auto Dark Mode directly.
- **Off**: disable the extension for the current site.

## Permissions

- `debugger`: required to call Chrome DevTools Protocol dark-mode emulation commands for the current tab.
- `scripting`: samples page colors locally and injects the detector on tabs that were open before install.
- `storage`: saves the global setting and per-site mode.
- `tabs`: detects the active tab and normal page navigations.
- `http://*/*`, `https://*/*`: lets the extension check and apply dark mode on normal websites.

## Development

```sh
npm run make:icons
npm test
npm run package
```

The packaged extension is written to `dist/auto-dark-mode-v0.1.0.zip`.

## Limitations

- Chrome's Auto Dark Mode command is exposed through the DevTools Protocol and is marked experimental by Chrome.
- Chrome may block debugger access if DevTools or another debugger is already attached to a tab.
- The extension does not click website dark-mode toggles. It uses standards-based `prefers-color-scheme` emulation first.
- Chrome internal pages, Web Store pages, and other restricted URLs are intentionally ignored.

