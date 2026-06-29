const pdfjsLib = window["pdfjs-dist/build/pdf"];
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const { average, buildCopyFields, detectYear, groupTextItemsByLine, parseSuicaLine } =
  window.SuicaParser;

const fileInput = document.getElementById("pdfFile");
const statusEl = document.getElementById("status");
const rowsEl = document.getElementById("rows");
const downloadAllBtn = document.getElementById("downloadAll");
const canvas = document.getElementById("pdfCanvas");
const previewStatusEl = document.getElementById("previewStatus");

let originalPdfBytes = null;
let currentPdf = null;
let detectedRows = [];
let selectedRowIndex = -1;
let previewRenderToken = 0;

/**
 * 選択されたPDFを読み込み、明細行の検出とプレビュー初期表示を行う。
 *
 * @param {Event} event ファイル選択イベント
 * @returns {Promise<void>}
 */
fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  resetState();

  statusEl.textContent = "PDFを解析中...";
  previewStatusEl.textContent = "プレビューを準備中...";

  originalPdfBytes = await file.arrayBuffer();
  currentPdf = await pdfjsLib.getDocument({ data: originalPdfBytes.slice(0) }).promise;

  await renderPreviewPage(0);
  detectedRows = await detectSuicaRows(currentPdf);

  if (detectedRows.length === 0) {
    statusEl.textContent =
      "明細行を検出できませんでした。PDF形式が想定と違う可能性があります。";
    previewStatusEl.textContent = "赤線プレビューはありません。";
    return;
  }

  statusEl.textContent = `${detectedRows.length}件の明細を検出しました。`;
  renderRows(detectedRows);
  await selectRow(0);
  downloadAllBtn.disabled = false;
});

/**
 * 検出済みの全明細について、赤線入りPDFを順番に出力する。
 *
 * @returns {Promise<void>}
 */
downloadAllBtn.addEventListener("click", async () => {
  for (const row of detectedRows) {
    await exportPdfWithRedLine(row);
  }
});

/**
 * PDF読み込み前の画面状態に戻す。
 *
 * @returns {void}
 */
function resetState() {
  rowsEl.innerHTML = "";
  downloadAllBtn.disabled = true;
  detectedRows = [];
  selectedRowIndex = -1;
  currentPdf = null;
  previewRenderToken++;
}

/**
 * 指定ページをCanvasに描画し、必要に応じて選択行の赤線を重ねる。
 *
 * @param {number} pageIndex 0始まりのページ番号
 * @param {object|null} [row=null] 赤線描画対象の明細情報
 * @returns {Promise<void>}
 */
async function renderPreviewPage(pageIndex, row = null) {
  if (!currentPdf) return;

  const token = ++previewRenderToken;
  const page = await currentPdf.getPage(pageIndex + 1);
  if (token !== previewRenderToken) return;

  const viewport = page.getViewport({ scale: 1.4 });
  const context = canvas.getContext("2d");

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({ canvasContext: context, viewport }).promise;
  if (token !== previewRenderToken) return;

  if (row) {
    drawPreviewRedLine(context, viewport, row);
  }
}

/**
 * プレビューCanvas上に、PDF座標をCanvas座標へ変換して赤線を描画する。
 *
 * @param {CanvasRenderingContext2D} context Canvasの描画コンテキスト
 * @param {object} viewport PDF.jsのビューポート
 * @param {object} row 赤線座標を含む明細情報
 * @returns {void}
 */
function drawPreviewRedLine(context, viewport, row) {
  const [startX, startY] = viewport.convertToViewportPoint(row.x1, row.y);
  const [endX, endY] = viewport.convertToViewportPoint(row.x2, row.y);

  context.save();
  context.strokeStyle = "#e00000";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
  context.restore();
}

/**
 * PDF内のテキストを解析し、Suica明細行と赤線座標を抽出する。
 *
 * @param {object} pdf PDF.jsで読み込んだPDFドキュメント
 * @returns {Promise<object[]>} 検出した明細行の配列
 */
async function detectSuicaRows(pdf) {
  const rows = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const textContent = await page.getTextContent();
    const pageView = page.view; // [xMin, yMin, xMax, yMax]
    const pageHeight = pageView[3] - pageView[1];

    const year = detectYear(textContent.items) ?? new Date().getFullYear();
    const grouped = groupTextItemsByLine(textContent.items);

    for (const line of grouped) {
      const lineText = line.items
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      const parsed = parseSuicaLine(lineText, year);
      if (!parsed) continue;

      const xMin = Math.min(...line.items.map((item) => item.transform[4]));
      const xMax = Math.max(...line.items.map((item) => item.transform[4] + (item.width || 0)));
      const y = average(line.items.map((item) => item.transform[5]));

      rows.push({
        pageIndex: pageNo - 1,
        pageHeight,
        x1: Math.max(20, xMin - 4),
        x2: xMax + 4,
        // 文字の少し下に赤線を引く。ズレる場合はこの -2 を調整する。
        y: y - 2,
        lineText,
        ...parsed,
      });
    }
  }

  return rows;
}

/**
 * 検出した明細一覧を画面に描画する。
 *
 * @param {object[]} rows 検出済みの明細行
 * @returns {void}
 */
function renderRows(rows) {
  rowsEl.innerHTML = "";

  rows.forEach((row, index) => {
    const div = document.createElement("div");
    div.className = "row-item";
    div.dataset.index = String(index);

    const main = document.createElement("div");
    main.className = "row-main";

    const text = document.createElement("button");
    text.type = "button";
    text.className = "row-text row-preview-button";
    text.addEventListener("click", () => selectRow(index));

    const title = document.createElement("strong");
    title.textContent = `${index + 1}. ${row.fromStation} → ${row.toStation}`;

    const meta = document.createElement("span");
    meta.className = "row-meta";
    meta.textContent = row.displayDate;

    const filename = document.createElement("span");
    filename.className = "filename";
    filename.textContent = row.filename;

    text.appendChild(title);
    text.appendChild(meta);
    text.appendChild(filename);
    main.appendChild(text);

    const copyFields = document.createElement("div");
    copyFields.className = "copy-fields";

    for (const field of buildCopyFields(row)) {
      copyFields.appendChild(createCopyButton(field));
    }

    main.appendChild(copyFields);

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "row-export-button";
    exportButton.textContent = "このPDFを出力";
    exportButton.addEventListener("click", () => exportPdfWithRedLine(row));

    actions.appendChild(exportButton);
    div.appendChild(main);
    div.appendChild(actions);
    rowsEl.appendChild(div);
  });
}

/**
 * 明細フィールド用のコピーボタンを作る。
 *
 * @param {{label: string, value: string}} field コピー対象フィールド
 * @returns {HTMLButtonElement} コピーボタン
 */
function createCopyButton(field) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button";
  button.dataset.copyLabel = field.label;
  button.dataset.copyValue = field.value;
  button.title = `${field.label}をコピー`;

  const label = document.createElement("span");
  label.className = "copy-button-label";
  label.textContent = field.label;

  const value = document.createElement("span");
  value.className = "copy-button-value";
  value.textContent = field.value;

  const status = document.createElement("span");
  status.className = "copy-button-status";
  status.textContent = "コピー";

  button.appendChild(label);
  button.appendChild(value);
  button.appendChild(status);
  button.addEventListener("click", async () => {
    await copyText(field.value);
    showCopyFeedback(button, "コピー済み");
  });

  return button;
}

/**
 * テキストをクリップボードにコピーする。
 *
 * @param {string} value コピーする文字列
 * @returns {Promise<void>}
 */
async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // file:// などでClipboard APIが拒否された場合は下の方式で再試行する。
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

/**
 * コピーボタンに一時的なフィードバック文言を表示する。
 *
 * @param {HTMLButtonElement} button 対象ボタン
 * @param {string} status 表示する状態文言
 * @returns {void}
 */
function showCopyFeedback(button, status) {
  const statusEl = button.querySelector(".copy-button-status");
  if (!statusEl) return;

  button.classList.add("is-copied");
  statusEl.textContent = status;

  window.setTimeout(() => {
    button.classList.remove("is-copied");
    statusEl.textContent = "コピー";
  }, 1200);
}

/**
 * 指定した明細行を選択状態にし、該当ページのプレビューを更新する。
 *
 * @param {number} index 選択する明細の配列インデックス
 * @returns {Promise<void>}
 */
async function selectRow(index) {
  const row = detectedRows[index];
  if (!row) return;

  selectedRowIndex = index;
  updateActiveRow();
  previewStatusEl.textContent = `${index + 1}件目をプレビュー中: ${row.displayDate} ${row.fromStation} → ${row.toStation}`;
  await renderPreviewPage(row.pageIndex, row);
}

/**
 * 一覧内の選択中スタイルを現在の選択行に合わせて更新する。
 *
 * @returns {void}
 */
function updateActiveRow() {
  rowsEl.querySelectorAll(".row-item").forEach((item, index) => {
    item.classList.toggle("is-active", index === selectedRowIndex);
  });
}

/**
 * 元PDFの対象ページに赤線を引き、個別PDFとしてダウンロードする。
 *
 * @param {object} row 赤線座標とファイル名を含む明細情報
 * @returns {Promise<void>}
 */
async function exportPdfWithRedLine(row) {
  if (!originalPdfBytes) return;

  const pdfDoc = await PDFLib.PDFDocument.load(originalPdfBytes.slice(0));
  const page = pdfDoc.getPage(row.pageIndex);

  page.drawLine({
    start: { x: row.x1, y: row.y },
    end: { x: row.x2, y: row.y },
    thickness: 2,
    color: PDFLib.rgb(1, 0, 0),
  });

  const pdfBytes = await pdfDoc.save();
  downloadPdf(pdfBytes, row.filename);
}

/**
 * PDFバイト列をBlob化し、ブラウザのダウンロードを開始する。
 *
 * @param {Uint8Array|ArrayBuffer} pdfBytes PDFのバイト列
 * @param {string} filename ダウンロード時のファイル名
 * @returns {void}
 */
function downloadPdf(pdfBytes, filename) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
