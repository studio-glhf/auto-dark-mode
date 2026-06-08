const test = require("node:test");
const assert = require("node:assert/strict");
const detector = require("../src/shared/detector-core.js");

test("parses rgb, rgba, and hex colors", () => {
  assert.deepEqual(detector.parseColor("rgb(255, 255, 255)"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(detector.parseColor("rgba(0, 0, 0, 0.5)"), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(detector.parseColor("#abc"), { r: 170, g: 187, b: 204, a: 1 });
});

test("scores light and dark probes", () => {
  const light = detector.scoreProbe({
    backgrounds: ["rgb(255, 255, 255)", "rgb(245, 245, 245)", "rgb(250, 250, 250)"],
    foregrounds: ["rgb(17, 24, 39)"]
  });
  const dark = detector.scoreProbe({
    backgrounds: ["rgb(18, 18, 18)", "rgb(30, 30, 30)", "rgb(20, 20, 20)"],
    foregrounds: ["rgb(240, 240, 240)"]
  });

  assert.equal(light.isLight, true);
  assert.equal(light.isDark, false);
  assert.equal(dark.isDark, true);
  assert.equal(dark.isLight, false);
});

test("detects meaningful native darkening", () => {
  const before = detector.scoreProbe({
    backgrounds: ["rgb(255, 255, 255)", "rgb(248, 248, 248)"],
    foregrounds: ["rgb(20, 20, 20)"]
  });
  const after = detector.scoreProbe({
    backgrounds: ["rgb(24, 24, 24)", "rgb(40, 40, 40)"],
    foregrounds: ["rgb(245, 245, 245)"]
  });
  const unchanged = detector.scoreProbe({
    backgrounds: ["rgb(250, 250, 250)", "rgb(245, 245, 245)"],
    foregrounds: ["rgb(20, 20, 20)"]
  });

  assert.equal(detector.hasMeaningfulDarkening(before, after), true);
  assert.equal(detector.hasMeaningfulDarkening(before, unchanged), false);
});

test("normalizes and resolves per-site rules", () => {
  assert.equal(detector.normalizeRule("native"), "native");
  assert.equal(detector.normalizeRule("unknown"), "auto");
  assert.equal(detector.resolveSiteRule({ "example.com": "force" }, "example.com"), "force");
  assert.equal(detector.resolveSiteRule({ "example.com": "force" }, "openai.com"), "auto");
});

