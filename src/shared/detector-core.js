(function initAutoDarkDetector(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.AutoDarkDetector = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildDetectorApi() {
  const DARK_TOGGLE_RE = /\b(dark|night|theme|appearance|color\s*scheme)\b/i;
  const RULES = new Set(["auto", "native", "force", "off"]);
  const MAX_VISIBLE_ELEMENTS = 90;
  const MAX_STYLESHEETS = 80;
  const MAX_CSS_RULES_PER_SHEET = 800;
  const MAX_TOGGLE_CANDIDATES = 160;
  const MAX_TOGGLE_SCAN_NODES = 1200;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function parseColor(value) {
    if (!value || typeof value !== "string") {
      return null;
    }

    const color = value.trim().toLowerCase();
    if (color === "transparent") {
      return { r: 0, g: 0, b: 0, a: 0 };
    }

    const rgb = color.match(/^rgba?\(([^)]+)\)$/);
    if (rgb) {
      const parts = rgb[1].split(",").map((part) => part.trim());
      if (parts.length >= 3) {
        return {
          r: clamp(Number.parseFloat(parts[0]), 0, 255),
          g: clamp(Number.parseFloat(parts[1]), 0, 255),
          b: clamp(Number.parseFloat(parts[2]), 0, 255),
          a: parts.length >= 4 ? clamp(Number.parseFloat(parts[3]), 0, 1) : 1
        };
      }
    }

    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const raw = hex[1].length === 3
        ? hex[1].split("").map((char) => char + char).join("")
        : hex[1];
      return {
        r: Number.parseInt(raw.slice(0, 2), 16),
        g: Number.parseInt(raw.slice(2, 4), 16),
        b: Number.parseInt(raw.slice(4, 6), 16),
        a: 1
      };
    }

    return null;
  }

  function channelToLinear(value) {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(color) {
    if (!color) {
      return null;
    }

    return (
      0.2126 * channelToLinear(color.r) +
      0.7152 * channelToLinear(color.g) +
      0.0722 * channelToLinear(color.b)
    );
  }

  function average(values) {
    const usable = values.filter((value) => Number.isFinite(value));
    if (!usable.length) {
      return null;
    }

    return usable.reduce((sum, value) => sum + value, 0) / usable.length;
  }

  function summarizeColorValues(values) {
    const luminances = values
      .map((value) => relativeLuminance(parseColor(value)))
      .filter((value) => Number.isFinite(value));

    if (!luminances.length) {
      return {
        average: null,
        lightRatio: 0,
        darkRatio: 0,
        count: 0
      };
    }

    return {
      average: average(luminances),
      lightRatio: luminances.filter((value) => value >= 0.68).length / luminances.length,
      darkRatio: luminances.filter((value) => value <= 0.28).length / luminances.length,
      count: luminances.length
    };
  }

  function scoreProbe(probe) {
    const backgrounds = summarizeColorValues(probe && Array.isArray(probe.backgrounds) ? probe.backgrounds : []);
    const foregrounds = summarizeColorValues(probe && Array.isArray(probe.foregrounds) ? probe.foregrounds : []);
    const backgroundLuminance = backgrounds.average;
    const foregroundLuminance = foregrounds.average;
    const isDark = backgrounds.darkRatio >= 0.5 || (backgroundLuminance !== null && backgroundLuminance <= 0.32);
    const isLight = backgrounds.lightRatio >= 0.42 || (backgroundLuminance !== null && backgroundLuminance >= 0.58);

    return {
      backgroundLuminance,
      foregroundLuminance,
      lightRatio: backgrounds.lightRatio,
      darkRatio: backgrounds.darkRatio,
      sampledBackgrounds: backgrounds.count,
      sampledForegrounds: foregrounds.count,
      isDark,
      isLight,
      hasNativeHints: Boolean(probe && probe.hints && probe.hints.hasNativeHints),
      hasToggleHint: Boolean(probe && probe.hints && probe.hints.hasToggleHint)
    };
  }

  function hasMeaningfulDarkening(before, after) {
    if (!before || !after || before.backgroundLuminance === null || after.backgroundLuminance === null) {
      return false;
    }

    const luminanceDrop = before.backgroundLuminance - after.backgroundLuminance;
    const darkRatioLift = after.darkRatio - before.darkRatio;
    return after.isDark || luminanceDrop >= 0.22 || (luminanceDrop >= 0.14 && darkRatioLift >= 0.22);
  }

  function normalizeRule(rule) {
    return RULES.has(rule) ? rule : "auto";
  }

  function resolveSiteRule(siteRules, hostname) {
    if (!hostname || !siteRules || typeof siteRules !== "object") {
      return "auto";
    }

    return normalizeRule(siteRules[hostname]);
  }

  function getVisibleElements() {
    if (typeof document === "undefined") {
      return [];
    }

    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const elements = new Set();
    const addElement = (element) => {
      if (element && elements.size < MAX_VISIBLE_ELEMENTS) {
        elements.add(element);
      }
    };

    addElement(document.documentElement);
    addElement(document.body);
    addElement(document.querySelector("main"));
    addElement(document.querySelector("article"));

    const columns = 5;
    const rows = 5;
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const x = Math.floor((viewportWidth * (column + 0.5)) / columns);
        const y = Math.floor((viewportHeight * (row + 0.5)) / rows);
        const element = document.elementFromPoint(x, y);
        if (element) {
          addElement(element);
          addElement(element.parentElement);
        }
      }
    }

    [
      "body",
      "main",
      "article",
      "section",
      "header",
      "nav",
      "aside",
      "footer",
      "[role='main']",
      "[class*='content']",
      "[class*='article']"
    ].forEach((selector) => {
      if (elements.size < MAX_VISIBLE_ELEMENTS) {
        addElement(document.querySelector(selector));
      }
    });

    return Array.from(elements).filter((element) => {
      if (!element || !element.isConnected) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number.parseFloat(style.opacity || "1") > 0.05;
    });
  }

  function hasUsableBackground(style) {
    const parsed = parseColor(style.backgroundColor);
    return parsed && parsed.a > 0.2;
  }

  function collectColorsFromElements(elements) {
    const backgrounds = [];
    const foregrounds = [];

    elements.forEach((element) => {
      const style = getComputedStyle(element);
      if (hasUsableBackground(style)) {
        backgrounds.push(style.backgroundColor);
      }

      if (style.color) {
        foregrounds.push(style.color);
      }
    });

    if (!backgrounds.length) {
      const bodyStyle = getComputedStyle(document.body || document.documentElement);
      const rootStyle = getComputedStyle(document.documentElement);
      backgrounds.push(bodyStyle.backgroundColor, rootStyle.backgroundColor, "rgb(255, 255, 255)");
    }

    return { backgrounds, foregrounds };
  }

  function detectHints() {
    if (typeof document === "undefined") {
      return {
        colorScheme: "",
        hasNativeHints: false,
        hasToggleHint: false
      };
    }

    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = document.body ? getComputedStyle(document.body) : null;
    const metaColorScheme = [
      document.querySelector("meta[name='color-scheme']"),
      document.querySelector("meta[name='supported-color-schemes']")
    ]
      .filter(Boolean)
      .map((element) => element.getAttribute("content") || "")
      .join(" ");
    const colorScheme = [
      rootStyle.colorScheme || "",
      bodyStyle ? bodyStyle.colorScheme || "" : "",
      metaColorScheme
    ].join(" ").trim();

    const hasNativeHints = /\bdark\b/i.test(colorScheme) || hasDarkPreferenceRule();

    const candidates = collectToggleCandidates(MAX_TOGGLE_CANDIDATES);
    const hasToggleHint = candidates.some((element) => {
      const text = [
        element.textContent || "",
        element.getAttribute("aria-label") || "",
        element.getAttribute("title") || "",
        element.getAttribute("name") || "",
        element.getAttribute("id") || "",
        element.getAttribute("class") || ""
      ].join(" ");
      return DARK_TOGGLE_RE.test(text);
    });

    return {
      colorScheme,
      hasNativeHints,
      hasToggleHint
    };
  }

  function hasDarkPreferenceRule() {
    if (typeof document === "undefined") {
      return false;
    }

    const styleSheets = document.styleSheets || [];
    const sheetCount = Math.min(styleSheets.length || 0, MAX_STYLESHEETS);
    for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
      const styleSheet = styleSheets[sheetIndex];
      let cssRules;
      try {
        cssRules = styleSheet ? styleSheet.cssRules : null;
      } catch (_error) {
        cssRules = null;
      }

      if (!cssRules) {
        continue;
      }

      const ruleCount = Math.min(cssRules.length || 0, MAX_CSS_RULES_PER_SHEET);
      for (let ruleIndex = 0; ruleIndex < ruleCount; ruleIndex += 1) {
        const rule = cssRules[ruleIndex];
        if (rule && /\(prefers-color-scheme:\s*dark\)/i.test(rule.cssText || "")) {
          return true;
        }
      }
    }

    return false;
  }

  function collectToggleCandidates(limit) {
    if (typeof document === "undefined") {
      return [];
    }

    const root = document.body || document.documentElement;
    if (!root || typeof document.createTreeWalker !== "function") {
      return [];
    }

    const nodeFilter = typeof NodeFilter !== "undefined" ? NodeFilter : { SHOW_ELEMENT: 1 };
    const selector = "button, a, input, select, [role='button'], [aria-label], [title]";
    const candidates = [];
    const walker = document.createTreeWalker(root, nodeFilter.SHOW_ELEMENT);
    let scanned = 0;

    while (scanned < MAX_TOGGLE_SCAN_NODES && candidates.length < limit) {
      const element = walker.nextNode();
      if (!element) {
        break;
      }

      scanned += 1;
      if (typeof element.matches === "function" && element.matches(selector)) {
        candidates.push(element);
      }
    }

    return candidates;
  }

  function probePage() {
    if (typeof document === "undefined") {
      return null;
    }

    const elements = getVisibleElements();
    const colors = collectColorsFromElements(elements);
    const hints = detectHints();
    const probe = {
      backgrounds: colors.backgrounds,
      foregrounds: colors.foregrounds,
      hints,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      sampledAt: Date.now()
    };

    return {
      ...probe,
      score: scoreProbe(probe)
    };
  }

  return {
    parseColor,
    relativeLuminance,
    scoreProbe,
    hasMeaningfulDarkening,
    normalizeRule,
    resolveSiteRule,
    probePage
  };
});
