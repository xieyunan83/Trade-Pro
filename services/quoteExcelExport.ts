/**
 * 外贸报价单 Excel 导出（对齐公司常用英文 FOB 样表：抬头 + 图 + 物流栏）
 */
import ExcelJS from 'exceljs';
import type { QuoteCompanyProfile, QuoteDoc, QuoteLine } from './quoteTypes';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E79' },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 10,
  name: 'Arial',
};
const THIN: Partial<ExcelJS.Border> = {
  style: 'thin',
  color: { argb: 'FFB0B0B0' },
};
const BORDERS: Partial<ExcelJS.Borders> = {
  top: THIN,
  left: THIN,
  bottom: THIN,
  right: THIN,
};

const dataUrlToBuffer = async (
  dataUrl?: string
): Promise<{ buffer: ArrayBuffer; ext: 'jpeg' | 'png' } | null> => {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  try {
    const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) return null;
    const mime = m[1].toLowerCase();
    const b64 = m[2];
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const ext = mime.includes('png') ? 'png' : 'jpeg';
    return { buffer: bytes.buffer, ext };
  } catch {
    return null;
  }
};

const fmtMoney = (n: number, currency: string) => {
  const v = Number.isFinite(n) ? n : 0;
  const prefix = currency.toUpperCase() === 'USD' ? '$' : `${currency} `;
  return `${prefix}${v.toFixed(3)}`;
};

const dim3 = (l?: number, w?: number, h?: number) => {
  if (l == null && w == null && h == null) return '';
  return [l, w, h].map((x) => (x == null || Number.isNaN(x) ? '' : Number(x).toFixed(1))).join(' × ');
};

const safeFileName = (s: string) =>
  (s || 'Quotation').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);

export const exportQuoteExcel = async (
  doc: QuoteDoc,
  profile: QuoteCompanyProfile
): Promise<void> => {
  const wb = new ExcelJS.Workbook();
  wb.creator = profile.companyName || 'Trade Pro';
  wb.created = new Date();
  const ws = wb.addWorksheet('Quotation', {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 16 },
  });

  // A Picture | B Item | C Desc | D Package | E CTN | F Inner | G Price
  // H-J Package Size | K-M Carton Size | N Cft | O Cbm | P GW | Q NW
  ws.columns = [
    { key: 'pic', width: 14 },
    { key: 'item', width: 16 },
    { key: 'desc', width: 42 },
    { key: 'pkg', width: 14 },
    { key: 'ctn', width: 10 },
    { key: 'inner', width: 8 },
    { key: 'price', width: 14 },
    { key: 'pl', width: 7 },
    { key: 'pw', width: 7 },
    { key: 'ph', width: 7 },
    { key: 'cl', width: 7 },
    { key: 'cw', width: 7 },
    { key: 'ch', width: 7 },
    { key: 'cft', width: 8 },
    { key: 'cbm', width: 8 },
    { key: 'gw', width: 8 },
    { key: 'nw', width: 8 },
  ];

  const company = profile.companyName || 'Your Company Name';
  ws.mergeCells('A1:Q1');
  ws.getCell('A1').value = company;
  ws.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF1F4E79' } };
  ws.getCell('A1').alignment = { vertical: 'middle' };
  ws.getRow(1).height = 24;

  ws.mergeCells('A2:Q2');
  ws.getCell('A2').value = profile.address ? `ADD:${profile.address}` : '';
  ws.getCell('A2').font = { name: 'Arial', size: 10 };

  ws.mergeCells('A3:Q3');
  const contactBits = [
    profile.tel ? `Tel: ${profile.tel}` : '',
    profile.fax ? `Fax: ${profile.fax}` : '',
    profile.email ? `E-mail:${profile.email}` : '',
    profile.website ? `Web:${profile.website}` : '',
  ].filter(Boolean);
  ws.getCell('A3').value = contactBits.join('   ');
  ws.getCell('A3').font = { name: 'Arial', size: 10 };

  ws.mergeCells('A4:Q4');
  ws.getCell('A4').value = 'QUOTATION';
  ws.getCell('A4').font = { name: 'Arial', size: 18, bold: true };
  ws.getCell('A4').alignment = { horizontal: 'center' };
  ws.getRow(4).height = 26;

  ws.mergeCells('A5:Q5');
  ws.getCell('A5').value =
    doc.priceBasisText ||
    `The price is base on ${doc.tradeTerm} ${doc.portOfLoading} full container loading,accepted by both parties.`;
  ws.getCell('A5').font = { name: 'Arial', size: 10, italic: true };

  ws.mergeCells('A6:Q6');
  ws.getCell('A6').value = `Quotation date: ${doc.quoteDate},Price is valided in ${doc.validDays || 30} days.`;
  ws.getCell('A6').font = { name: 'Arial', size: 10 };

  ws.mergeCells('A7:Q7');
  const attn = doc.attn || doc.clientName || '';
  ws.getCell('A7').value = attn ? `Attn:${attn}` : '';
  ws.getCell('A7').font = { name: 'Arial', size: 10, bold: true };

  // Header row 8 — with merged size groups like sample
  const headerRow = 8;
  const headers: Array<{ col: number; text: string; merge?: number }> = [
    { col: 1, text: 'Picture' },
    { col: 2, text: 'Item No.' },
    { col: 3, text: 'Description' },
    { col: 4, text: 'Package' },
    { col: 5, text: 'CTN/PCS' },
    { col: 6, text: 'Inner' },
    { col: 7, text: `FOB ${doc.portOfLoading || 'SHANTOU'}\nPRICE(${doc.currency || 'USD'})` },
    { col: 8, text: 'Package Size(CM)', merge: 3 },
    { col: 11, text: 'Carton Size(CM)', merge: 3 },
    { col: 14, text: 'Cft' },
    { col: 15, text: 'Cbm' },
    { col: 16, text: 'G.W.' },
    { col: 17, text: 'N.W.' },
  ];

  for (const h of headers) {
    if (h.merge && h.merge > 1) {
      ws.mergeCells(headerRow, h.col, headerRow, h.col + h.merge - 1);
    }
    const cell = ws.getCell(headerRow, h.col);
    cell.value = h.text;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDERS;
    if (h.merge) {
      for (let c = h.col + 1; c < h.col + h.merge; c += 1) {
        const cc = ws.getCell(headerRow, c);
        cc.fill = HEADER_FILL;
        cc.border = BORDERS;
      }
    }
  }
  ws.getRow(headerRow).height = 32;

  let rowIdx = headerRow + 1;
  for (const line of doc.lines) {
    const row = ws.getRow(rowIdx);
    row.height = 64;
    const values: Record<number, string | number> = {
      2: line.skuCode || '',
      3: line.nameEn || line.nameZh || '',
      4: line.packing || '',
      5: line.cartonQty || '',
      6: line.innerBox || 0,
      7: fmtMoney(Number(line.unitPrice) || 0, line.currency || doc.currency),
      8: line.pkgL ?? '',
      9: line.pkgW ?? '',
      10: line.pkgH ?? '',
      11: line.ctnL ?? '',
      12: line.ctnW ?? '',
      13: line.ctnH ?? '',
      14: line.cft ?? '',
      15: line.cbm ?? '',
      16: line.gwKg ?? '',
      17: line.nwKg ?? '',
    };
    for (let c = 1; c <= 17; c += 1) {
      const cell = row.getCell(c);
      if (c !== 1) cell.value = values[c] ?? '';
      cell.border = BORDERS;
      cell.font = { name: 'Arial', size: 9 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: c === 3 ? 'left' : 'center',
        wrapText: c === 3,
      };
      if (c === 7) cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFC00000' } };
    }

    const img = await dataUrlToBuffer(line.imageDataUrl);
    if (img) {
      const imageId = wb.addImage({
        buffer: img.buffer,
        extension: img.ext,
      });
      ws.addImage(imageId, {
        tl: { col: 0.15, row: rowIdx - 1 + 0.15 },
        ext: { width: 72, height: 72 },
        editAs: 'oneCell',
      });
    }
    rowIdx += 1;
  }

  // Footer summary
  rowIdx += 1;
  ws.mergeCells(rowIdx, 1, rowIdx, 17);
  const totalCbm = doc.lines.reduce((s, l) => s + (Number(l.cbm) || 0), 0);
  const totalAmt = doc.lines.reduce(
    (s, l) => s + (Number(l.unitPrice) || 0) * Math.max(1, l.qty || 1),
    0
  );
  ws.getCell(rowIdx, 1).value = [
    `Quote No: ${doc.quoteNo}`,
    doc.clientName ? `Customer: ${doc.clientName}` : '',
    `Items: ${doc.lines.length}`,
    `Total CBM(1 ctn each): ${totalCbm.toFixed(3)}`,
    `Amount(ref): ${fmtMoney(totalAmt, doc.currency)}`,
    doc.paymentTerms ? `Payment: ${doc.paymentTerms}` : '',
  ]
    .filter(Boolean)
    .join('  |  ');
  ws.getCell(rowIdx, 1).font = { name: 'Arial', size: 9, italic: true };

  if (doc.externalRemarks) {
    rowIdx += 1;
    ws.mergeCells(rowIdx, 1, rowIdx, 17);
    ws.getCell(rowIdx, 1).value = `Remarks: ${doc.externalRemarks}`;
    ws.getCell(rowIdx, 1).font = { name: 'Arial', size: 9 };
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const nameBit = doc.clientName || doc.title || doc.quoteNo;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Quotation ${safeFileName(nameBit)} ${doc.quoteDate}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/** 调试/预览用：行物流摘要 */
export const lineLogisticsHint = (line: QuoteLine): string => {
  const ctn = dim3(line.ctnL, line.ctnW, line.ctnH);
  return [ctn && `外箱 ${ctn}`, line.cbm != null && `CBM ${line.cbm}`, line.gwKg != null && `GW ${line.gwKg}`]
    .filter(Boolean)
    .join(' · ');
};
