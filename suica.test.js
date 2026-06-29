const assert = require("node:assert/strict");
const test = require("node:test");
const {
  average,
  buildFilename,
  buildCopyFields,
  detectYear,
  formatCopyAmount,
  formatStationForPayee,
  groupTextItemsByLine,
  parseSuicaLine,
  sanitizeFilename,
} = require("./suica");

test("parseSuicaLine parses a normal Suica detail line", () => {
  assert.deepStrictEqual(parseSuicaLine("06 12 入 渋谷 出 新宿 -180", 2026), {
    date: "20260612",
    displayDate: "2026/06/12",
    fromStation: "渋谷",
    toStation: "新宿",
    amount: "-180",
    filename: "20260612_渋谷_to_新宿_redline.pdf",
  });
});

test("parseSuicaLine parses mojibake enter and exit markers", () => {
  assert.deepStrictEqual(parseSuicaLine("6 2 蜈･ 池袋 蜃ｺ 上野 -210", 2026), {
    date: "20260602",
    displayDate: "2026/06/02",
    fromStation: "池袋",
    toStation: "上野",
    amount: "-210",
    filename: "20260602_池袋_to_上野_redline.pdf",
  });
});

test("parseSuicaLine removes comma separators from amount", () => {
  const row = parseSuicaLine("5 3 入 品川 出 横浜 -1,230", 2026);

  assert.equal(row.amount, "-1230");
});

test("buildCopyFields creates payee, date, and positive amount values", () => {
  const row = parseSuicaLine("6 29 入 渋谷 出 新宿 -180", 2026);

  assert.deepStrictEqual(buildCopyFields(row), [
    { key: "payee", label: "支払先", value: "入　渋谷駅　出　新宿駅" },
    { key: "date", label: "日付", value: "2026/06/29" },
    { key: "amount", label: "金額", value: "180" },
  ]);
});

test("formatStationForPayee does not duplicate station suffix", () => {
  assert.equal(formatStationForPayee("渋谷駅"), "渋谷駅");
  assert.equal(formatStationForPayee("新宿"), "新宿駅");
});

test("formatCopyAmount removes commas and a leading minus sign", () => {
  assert.equal(formatCopyAmount("-1,230"), "1230");
  assert.equal(formatCopyAmount("406"), "406");
});

test("parseSuicaLine returns null for non-detail text", () => {
  assert.equal(parseSuicaLine("残額 ご利用明細", 2026), null);
});

test("detectYear finds a western year near a date", () => {
  const items = [{ str: "発行日" }, { str: "2026/06/29" }];

  assert.equal(detectYear(items), 2026);
});

test("detectYear returns null when no date year exists", () => {
  const items = [{ str: "発行日" }, { str: "06/29" }];

  assert.equal(detectYear(items), null);
});

test("groupTextItemsByLine groups nearby y positions and sorts from top to bottom", () => {
  const items = [
    { str: "lower", transform: [1, 0, 0, 1, 10, 100] },
    { str: "upper", transform: [1, 0, 0, 1, 10, 200] },
    { str: "same line", transform: [1, 0, 0, 1, 40, 201] },
    { str: " ", transform: [1, 0, 0, 1, 10, 300] },
  ];

  const grouped = groupTextItemsByLine(items);

  assert.equal(grouped.length, 2);
  assert.deepStrictEqual(
    grouped.map((line) => line.items.map((item) => item.str)),
    [["upper", "same line"], ["lower"]]
  );
});

test("buildFilename sanitizes station names", () => {
  assert.equal(
    buildFilename("20260612", "渋 谷", "新/宿:駅"),
    "20260612_渋谷_to_新_宿_駅_redline.pdf"
  );
});

test("sanitizeFilename removes whitespace, replaces invalid characters, and limits length", () => {
  const sanitized = sanitizeFilename(" a/b:c*d?e\"f<g>h|ijklmnopqrstuvwxyz0123456789 ");

  assert.equal(sanitized, "a_b_c_d_e_f_g_h_ijklmnopqrstuvwxyz012345");
  assert.equal(sanitized.length, 40);
});

test("average returns the arithmetic mean", () => {
  assert.equal(average([10, 20, 30]), 20);
});
