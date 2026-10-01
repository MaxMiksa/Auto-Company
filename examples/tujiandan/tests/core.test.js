import test from "node:test";
import assert from "node:assert/strict";
import { detectFormat, evaluateBatch, statusForItem, csvRows } from "../core.js";

const rules = {
  minWidth: 1200, minHeight: 1200, maxBytes: 5 * 1024 * 1024,
  formats: ["png", "jpeg", "webp"], nameStyle: "spaces", prefix: ""
};

test("按内容识别格式，未知内容不靠扩展名冒充图片", () => {
  assert.equal(detectFormat(Uint8Array.from([137,80,78,71,13,10,26,10])), "png");
  assert.equal(detectFormat(Uint8Array.from([255,216,255])), "jpeg");
  assert.equal(detectFormat(Uint8Array.from([82,73,70,70,0,0,0,0,87,69,66,80])), "webp");
  assert.equal(detectFormat(Uint8Array.from([60,115,118,103,62])), "svg");
  assert.equal(detectFormat(Uint8Array.from([60,115,118,103,120,62])), null);
});

test("同一批次能同时指出四项问题，且边界值通过", () => {
  const items = [
    { name: "合格.png", format: "png", width: 1200, height: 1200, bytes: rules.maxBytes },
    { name: "小图.png", format: "png", width: 390, height: 1200, bytes: 100 },
    { name: "大图.png", format: "png", width: 1600, height: 1600, bytes: rules.maxBytes + 1 },
    { name: " 前后空格 .gif", format: "gif", width: 1600, height: 1600, bytes: 100 }
  ];
  evaluateBatch(items, rules);
  assert.equal(statusForItem(items[0]), "通过");
  assert.deepEqual(items[1].issues.map(x => x.kind), ["size"]);
  assert.deepEqual(items[2].issues.map(x => x.kind), ["weight"]);
  assert.deepEqual(items[3].issues.map(x => x.kind), ["format", "name"]);
  assert.match(csvRows(items, rules), /本次检查规则/);
  assert.match(csvRows(items, rules), /390 × 1200 px/);
});

test("扩展名伪装、损坏文件和大小写重名都不会被判为通过", () => {
  const items = [
    { name: "Photo.png", format: "jpeg", width: 1200, height: 1200, bytes: 100 },
    { name: "photo.png", format: "png", width: 1200, height: 1200, bytes: 100 },
    { name: "bad.png", format: null, width: null, height: null, bytes: 0 }
  ];
  evaluateBatch(items, rules);
  assert.equal(statusForItem(items[0]), "需处理");
  assert.ok(items[0].issues.some(x => x.text.includes("扩展名")));
  assert.ok(items[0].issues.some(x => x.text.includes("重复")));
  assert.ok(items[1].issues.some(x => x.text.includes("重复")));
  assert.equal(statusForItem(items[2]), "无法检查");
  assert.match(csvRows(items, rules), /无法检查/);
});

test("SVG 识别为不允许的格式，未知像素尺寸不伪装为位图尺寸", () => {
  const item = { name: "图标.svg", format: "svg", width: null, height: null, bytes: 176 };
  evaluateBatch([item], rules);
  assert.equal(statusForItem(item), "无法检查");
  assert.ok(item.issues.some(x => x.text.includes("SVG 不在允许格式内")));
  assert.match(csvRows([item], rules), /"176","无法检查"/);
});
