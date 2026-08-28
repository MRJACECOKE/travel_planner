"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "donghae-planner.html"), "utf8");

assert.match(html, /color-scheme:light only/);
assert.match(html, /prefers-reduced-motion:reduce/);
assert.match(html, /overflow-x:hidden/);
assert.match(html, /map\.naver\.com/);
assert.match(html, /function sortCorridor\(/);
assert.doesNotMatch(html, /tmap|kakao|카카오|회랑|북상/i);
assert.doesNotMatch(html, /google\.com\/maps|maps\.google/i);

for (const tag of ["html", "head", "style", "body", "header", "nav", "main", "section", "aside", "footer", "form", "fieldset", "div", "p", "h1", "h2", "ol", "li", "button", "a", "span", "select", "option", "details", "summary", "script"]) {
  const opens = (html.match(new RegExp(`<${tag}(?:\\s|>)`, "gi")) || []).length;
  const closes = (html.match(new RegExp(`</${tag}>`, "gi")) || []).length;
  assert.equal(opens, closes, `${tag} 태그 수가 일치해야 합니다.`);
}

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, "인라인 스크립트가 필요합니다.");
new Function(scriptMatch[1]);

const placesMatch = html.match(/var PLACES=\[([\s\S]*?)\n\];/);
assert.ok(placesMatch, "PLACES 데이터를 읽을 수 있어야 합니다.");
const places = Function(`return [${placesMatch[1]}\n]`)();
assert.equal(places.length, 50, "PLACES는 정확히 50곳이어야 합니다.");
assert.equal(new Set(places.map((place) => place.id)).size, 50, "장소 ID는 중복되지 않아야 합니다.");
assert.equal(places.filter((place) => place.peninsula).length, 2, "호미곶 진입 구간 표시를 유지해야 합니다.");

for (const endLeg of [7, 14, 19, 24, 30]) {
  const sorted = places.filter((place) => place.leg <= endLeg).sort((a, b) => a.leg - b.leg || a.ll[0] - b.ll[0] || a.id.localeCompare(b.id));
  assert.ok(sorted.every((place, index) => index === 0 || sorted[index - 1].leg <= place.leg), `${endLeg} 범위의 장소 순서는 leg 단조 증가여야 합니다.`);
}

for (const place of places) {
  assert.equal(place.ll.length, 2, `${place.id} 좌표가 필요합니다.`);
  assert.ok(Number.isFinite(place.ll[0]) && Number.isFinite(place.ll[1]), `${place.id} 좌표는 숫자여야 합니다.`);
}

console.log("verify-planner: ok");
