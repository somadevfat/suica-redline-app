(function (global) {
  "use strict";

  /**
   * PDF.jsのテキスト要素をY座標の近さで行単位にまとめる。
   *
   * @param {object[]} items PDF.jsのテキスト要素
   * @returns {{key: number, items: object[]}[]} 上から下へ並んだ行グループ
   */
  function groupTextItemsByLine(items) {
    const map = new Map();

    for (const item of items) {
      const text = item.str?.trim();
      if (!text) continue;

      const y = item.transform[5];
      const key = Math.round(y / 3) * 3;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(item);
    }

    return [...map.entries()]
      .map(([key, lineItems]) => ({ key, items: lineItems }))
      .sort((a, b) => b.key - a.key);
  }

  /**
   * PDF内の年月日表記から明細の年を推定する。
   *
   * @param {object[]} items PDF.jsのテキスト要素
   * @returns {number|null} 検出できた西暦年。見つからない場合はnull
   */
  function detectYear(items) {
    const allText = items.map((item) => item.str).join(" ");
    const match = allText.match(/(20\d{2})\s*\/\s*\d{1,2}\s*\/\s*\d{1,2}/);
    return match ? Number(match[1]) : null;
  }

  /**
   * 1行分のテキストをSuica明細として解釈し、出力用データに変換する。
   *
   * @param {string} text 解析対象の行テキスト
   * @param {number} year 明細日付に補完する西暦年
   * @returns {object|null} 明細として解釈できた場合のデータ。対象外ならnull
   */
  function parseSuicaLine(text, year) {
    // 例: 06 12 入 渋谷 出 新宿 -180
    // 文字化けしたPDF抽出結果にも対応する。
    const match = text.match(
      /^(\d{1,2})\s+(\d{1,2})\s+(?:入|蜈･)\s+(.+?)\s+(?:出|蜃ｺ)\s+(.+?)\s+(-?[\d,]+)\s*$/
    );
    if (!match) return null;

    const [, monthRaw, dayRaw, fromStationRaw, toStationRaw, amountRaw] = match;
    const month = monthRaw.padStart(2, "0");
    const day = dayRaw.padStart(2, "0");
    const date = `${year}${month}${day}`;
    const displayDate = `${year}/${month}/${day}`;
    const fromStation = fromStationRaw.trim();
    const toStation = toStationRaw.trim();
    const amount = amountRaw.replace(/,/g, "");

    return {
      date,
      displayDate,
      fromStation,
      toStation,
      amount,
      filename: buildFilename(date, fromStation, toStation),
    };
  }

  /**
   * コピー用に表示する明細フィールドを作る。
   *
   * @param {object} row 明細情報
   * @returns {{key: string, label: string, value: string}[]} コピー対象フィールド
   */
  function buildCopyFields(row) {
    return [
      {
        key: "payee",
        label: "支払先",
        value: `入　${formatStationForPayee(row.fromStation)}　出　${formatStationForPayee(
          row.toStation
        )}`,
      },
      {
        key: "date",
        label: "日付",
        value: row.displayDate,
      },
      {
        key: "amount",
        label: "金額",
        value: formatCopyAmount(row.amount),
      },
    ];
  }

  /**
   * 支払先コピー用に駅名の末尾を整える。
   *
   * @param {string} station 駅名
   * @returns {string} 末尾に駅を付けた駅名
   */
  function formatStationForPayee(station) {
    return station.endsWith("駅") ? station : `${station}駅`;
  }

  /**
   * コピー用の金額として、カンマと支出を表すマイナス記号を除去する。
   *
   * @param {string|number} amount 明細金額
   * @returns {string} コピー用の金額
   */
  function formatCopyAmount(amount) {
    return String(amount).replace(/,/g, "").replace(/^-/, "");
  }

  /**
   * 明細情報から出力PDFのファイル名を作る。
   *
   * @param {string} date yyyymmdd形式の日付
   * @param {string} fromStation 入場駅名
   * @param {string} toStation 出場駅名
   * @returns {string} 出力ファイル名
   */
  function buildFilename(date, fromStation, toStation) {
    const from = sanitizeFilename(fromStation);
    const to = sanitizeFilename(toStation);
    return `${date}_${from}_to_${to}_redline.pdf`;
  }

  /**
   * ファイル名として使えない文字や空白を取り除く。
   *
   * @param {string} value 変換前の文字列
   * @returns {string} ファイル名に使いやすい文字列
   */
  function sanitizeFilename(value) {
    return value
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "")
      .slice(0, 40);
  }

  /**
   * 数値配列の平均値を返す。
   *
   * @param {number[]} values 平均を求める数値配列
   * @returns {number} 平均値
   */
  function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  const SuicaParser = {
    average,
    buildFilename,
    buildCopyFields,
    detectYear,
    formatCopyAmount,
    formatStationForPayee,
    groupTextItemsByLine,
    parseSuicaLine,
    sanitizeFilename,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SuicaParser;
  }

  global.SuicaParser = SuicaParser;
})(typeof globalThis !== "undefined" ? globalThis : window);
