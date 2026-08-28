"use strict";

const fs = require("node:fs");
const path = require("node:path");

const UPSTREAM = "http://openapi.tour.go.kr/openapi/service/TourismResourceStatsService/getPchrgTrrsrtVisitorList";
const SOURCE = {
  name: "한국문화관광연구원 관광자원통계서비스",
  url: "https://www.data.go.kr/data/15000366/openapi.do",
  method: "주요 유료관광지의 월별 내국인·외국인 입장객 합계"
};
const SNAPSHOT_PATH = path.join(process.cwd(), "versions", "v2", "data", "popularity.json");
const MAP_PATH = path.join(process.cwd(), "versions", "v2", "data", "place-map.json");
const CACHE_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
const MONTHS_TO_CHECK = 8;

let memoryCache = null;
let inFlight = null;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", status === 200 ? "public, s-maxage=86400, stale-while-revalidate=604800" : "no-store");
  res.end(JSON.stringify(body));
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tag(xml, name) {
  const match = String(xml).match(new RegExp("<" + name + ">(\\\\s|\\\\S)*?</" + name + ">", "i"));
  if (!match) return "";
  return decodeXml(match[0].replace(new RegExp("^<" + name + ">|</" + name + ">$", "gi"), "").trim());
}

function parseItems(xml) {
  const chunks = String(xml).match(/<item>[\s\S]*?<\/item>/gi) || [];
  return chunks.map((chunk) => ({
    ym: tag(chunk, "ym"),
    sido: tag(chunk, "sido"),
    gungu: tag(chunk, "gungu"),
    resNm: tag(chunk, "resNm"),
    domestic: Number(tag(chunk, "csNatCnt").replace(/,/g, "")) || 0,
    foreign: Number(tag(chunk, "csForCnt").replace(/,/g, "")) || 0
  }));
}

function normalized(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, "").trim();
}

function mappingKey(sido, gungu, resNm) {
  return [normalized(sido), normalized(gungu), normalized(resNm)].join("|");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function verifiedMappings() {
  const data = readJson(MAP_PATH);
  if (!Array.isArray(data.mappings)) return [];
  return data.mappings.filter((item) => item && item.verified === true && item.placeId && item.sido && item.gungu && item.resNm);
}

function recentSnapshot() {
  try {
    const data = readJson(SNAPSHOT_PATH);
    const generated = Date.parse(data.generatedAt || "");
    if (data.status !== "ready" || !Array.isArray(data.items) || !data.items.length) return null;
    if (!Number.isFinite(generated) || Date.now() - generated > SNAPSHOT_MAX_AGE_MS) return null;
    return data;
  } catch (error) {
    return null;
  }
}

function monthSequence() {
  const result = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  for (let index = 0; index < MONTHS_TO_CHECK; index += 1) {
    result.push(String(cursor.getUTCFullYear()) + String(cursor.getUTCMonth() + 1).padStart(2, "0"));
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return result;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestXml(url, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/xml,text/xml" } });
    if (!response.ok) {
      const error = new Error("UPSTREAM_HTTP_" + response.status);
      error.retryable = response.status >= 500;
      throw error;
    }
    return await response.text();
  } catch (error) {
    if (attempt === 0 && (error.name === "AbortError" || error.retryable || error instanceof TypeError)) {
      await wait(300);
      return requestXml(url, 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMonth(serviceKey, ym) {
  const records = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = UPSTREAM + "?serviceKey=" + serviceKey + "&YM=" + encodeURIComponent(ym) + "&numOfRows=" + PAGE_SIZE + "&pageNo=" + page;
    const xml = await requestXml(url);
    const resultCode = tag(xml, "resultCode");
    if (resultCode && resultCode !== "00" && resultCode !== "0000") throw new Error("UPSTREAM_RESULT_" + resultCode);
    const pageItems = parseItems(xml);
    records.push(...pageItems);
    const total = Number(tag(xml, "totalCount")) || records.length;
    if (!pageItems.length || records.length >= total) break;
  }
  return records;
}

function monthPeriod(ym) {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(4, 6));
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-01",
    end: ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-" + String(endDay).padStart(2, "0")
  };
}

async function collectPopularity(serviceKey, mappings) {
  const mapByProvider = new Map(mappings.map((item) => [mappingKey(item.sido, item.gungu, item.resNm), item]));
  for (const ym of monthSequence()) {
    const records = await fetchMonth(serviceKey, ym);
    const matched = [];
    for (const record of records) {
      const mapping = mapByProvider.get(mappingKey(record.sido, record.gungu, record.resNm));
      const visitors = record.domestic + record.foreign;
      if (!mapping || visitors <= 0) continue;
      matched.push({
        placeId: mapping.placeId,
        visitors,
        domesticVisitors: record.domestic,
        foreignVisitors: record.foreign,
        provisional: true
      });
    }
    if (matched.length) {
      matched.sort((a, b) => b.visitors - a.visitors || a.placeId.localeCompare(b.placeId));
      return {
        schemaVersion: 1,
        status: "ready",
        metric: "actual_visitors",
        source: SOURCE,
        period: monthPeriod(ym),
        generatedAt: new Date().toISOString(),
        coverage: { matched: matched.length, total: 50 },
        provisional: true,
        items: matched
      };
    }
  }
  const error = new Error("NO_MATCHED_DATA");
  error.statusCode = 503;
  throw error;
}

async function getPopularity() {
  if (memoryCache && Date.now() - memoryCache.savedAt < CACHE_MS) return memoryCache.data;
  const mappings = verifiedMappings();
  if (!mappings.length) {
    const error = new Error("MAPPING_REQUIRED");
    error.statusCode = 503;
    throw error;
  }
  const serviceKey = String(process.env.DATA_GO_KR_SERVICE_KEY || "").trim();
  if (!serviceKey) {
    const error = new Error("KEY_REQUIRED");
    error.statusCode = 503;
    throw error;
  }
  const data = await collectPopularity(serviceKey, mappings);
  memoryCache = { savedAt: Date.now(), data };
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { status: "method_not_allowed" });
  }
  if (!inFlight) inFlight = getPopularity().finally(() => { inFlight = null; });
  try {
    return send(res, 200, await inFlight);
  } catch (error) {
    const snapshot = recentSnapshot();
    if (snapshot) return send(res, 200, Object.assign({}, snapshot, { cacheStatus: "stored_snapshot" }));
    return send(res, error.statusCode || 502, {
      schemaVersion: 1,
      status: "configuration_required",
      reason: error.message === "MAPPING_REQUIRED" ? "verified_mapping_required" : error.message === "KEY_REQUIRED" ? "service_key_required" : "upstream_unavailable",
      metric: "actual_visitors",
      source: SOURCE,
      period: { start: null, end: null },
      generatedAt: null,
      items: []
    });
  }
};

module.exports._test = { decodeXml, tag, parseItems, mappingKey, monthPeriod };
