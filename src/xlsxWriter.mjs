import { writeFile } from 'node:fs/promises';

const MONEY_KEYS = /(?:amt|amount|balance|fee|金额|余额)/i;
const DATE_KEYS = /(?:date|time|日期|时间)/i;

export async function writeXlsx(rows, file, options = {}) {
  const columns = buildColumns(rows, options.kind);
  const matrix = [
    columns.map(column => column.header),
    ...rows.map(row => columns.map(column => cellValue(row, column)))
  ];
  const sheetXml = worksheetXml(matrix, columns);
  const files = xlsxFiles(sheetXml);
  await writeFile(file, zip(files));
}

function buildColumns(rows, kind) {
  const keys = Array.from(new Set(rows.flatMap(row => Object.keys(flatten(row)))));
  const preferred = kind === 'card'
    ? [
      column('jndatetimeStr', '交易时间', 'datetime', 20),
      column('turnoverType', '流水类型', 'text', 12),
      column('payName', '交易名称', 'text', 16),
      column('toMerchant', '商户', 'text', 24),
      column('locationName', '地点', 'text', 12),
      column('tranamt', '交易金额', 'moneyCents', 12),
      column('cardBalance', '账户余额', 'moneyCents', 12),
      column('resume', '摘要', 'text', 32),
      column('remark', '备注', 'text', 44),
      column('orderId', '订单号', 'id', 34),
      column('sno', '学号', 'id', 14)
    ]
    : [];
  const used = new Set(preferred.map(item => item.key));
  const rest = keys
    .filter(key => !used.has(key))
    .map(key => column(key, humanizeKey(key), inferType(key), widthForKey(key)));
  return [...preferred.filter(item => keys.includes(item.key)), ...rest];
}

function column(key, header, type, width) {
  return { key, header, type, width };
}

function cellValue(row, column) {
  const value = flatten(row)[column.key];
  if (value === undefined || value === null) return { type: 'blank', value: null, style: 0 };
  if (column.type === 'datetime') return dateCell(value);
  if (column.type === 'moneyCents') return numberCell(Number(value) / 100, 3);
  if (column.type === 'number') return numberCell(Number(value), 2);
  if (column.type === 'id') return { type: 'string', value: textId(value), style: 4 };
  return { type: 'string', value: String(value), style: 0 };
}

function dateCell(value) {
  const date = parseDate(value);
  return date
    ? { type: 'number', value: excelSerial(date), style: 2 }
    : { type: 'string', value: String(value), style: 0 };
}

function numberCell(value, style) {
  return Number.isFinite(value)
    ? { type: 'number', value, style }
    : { type: 'string', value: '', style: 0 };
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
}

function excelSerial(date) {
  return date.getTime() / 86400000 + 25569;
}

function inferType(key) {
  if (DATE_KEYS.test(key)) return 'datetime';
  if (MONEY_KEYS.test(key)) return 'moneyCents';
  return 'text';
}

function widthForKey(key) {
  if (DATE_KEYS.test(key)) return 20;
  if (MONEY_KEYS.test(key)) return 12;
  if (/remark|resume|merchant|name|备注|摘要|名称|商户/i.test(key)) return 28;
  return 14;
}

function humanizeKey(key) {
  const labels = {
    isRefund: '是否退款',
    refundStatus: '退款状态',
    refundTranamt: '退款金额',
    fromAccount: '付款账户',
    accType: '账户类型',
    fromJnNumber: '付款流水号',
    toAccount: '收款账户',
    posCode: '终端编号',
    operCode: '操作码',
    jndatetime: '交易时间原值',
    effectdate: '入账时间原值',
    effectdateStr: '入账时间',
    cardBalance: '账户余额',
    ebagamt: '电子钱包金额',
    usedcardnum: '用卡号',
    tranamt: '交易金额',
    ensureAmt: '保证金额',
    feeAmt: '手续费',
    consumeType: '消费类型',
    consumeTypeName: '消费类型名称',
    bankacc: '银行账户',
    pidName: '项目名称',
    deptName: '部门名称',
    tranCode: '交易代码',
    typeFrom: '来源类型',
    typeId: '类型编号',
    jndatetimeStr: '交易时间',
    payName: '交易名称',
    payIcon: '交易图标',
    labelName: '标签名称',
    labelRemark: '标签备注',
    locationName: '地点',
    dineSeq: '餐次',
    thirdOrderId: '第三方订单号',
    msCard: '虚拟卡',
    toMerchant: '商户'
  };
  return labels[key] || key;
}

function textId(value) {
  const text = String(value);
  return /^\d{12,}$/.test(text) ? `\u200c${text}` : text;
}

function worksheetXml(matrix, columns) {
  const rowXml = matrix.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => {
      const value = rowIndex === 0 ? { type: 'string', value: cell, style: 1 } : cell;
      return cellXml(address(rowIndex + 1, columnIndex + 1), value);
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const last = address(Math.max(matrix.length, 1), Math.max(columns.length, 1));
  const colXml = columns.map((col, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${col.width}" customWidth="1"/>`
  ).join('');
  return xml(`\
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${colXml}</cols>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="A1:${last}"/>
</worksheet>`);
}

function cellXml(ref, cell) {
  if (!cell || cell.type === 'blank') return `<c r="${ref}"/>`;
  const style = cell.style ? ` s="${cell.style}"` : '';
  if (cell.type === 'number') return `<c r="${ref}"${style}><v>${cell.value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(cell.value)}</t></is></c>`;
}

function address(row, column) {
  let name = '';
  let n = column;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return `${name}${row}`;
}

function xlsxFiles(sheetXml) {
  return {
    '[Content_Types].xml': xml(`\
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`),
    '_rels/.rels': xml(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    'docProps/core.xml': xml(`\
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>南林电力守夜</dc:creator>
  <cp:lastModifiedBy>南林电力守夜</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`),
    'docProps/app.xml': xml(`\
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>南林电力守夜</Application>
</Properties>`),
    'xl/workbook.xml': xml(`\
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="一卡通流水" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': xml(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': xml(`\
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/>
    <numFmt numFmtId="165" formatCode="#,##0.00"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Arial"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF136F45"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD9E2D0"/></left><right style="thin"><color rgb="FFD9E2D0"/></right><top style="thin"><color rgb="FFD9E2D0"/></top><bottom style="thin"><color rgb="FFD9E2D0"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`),
    'xl/worksheets/sheet1.xml': sheetXml
  };
}

function zip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function flatten(obj, prefix = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { [prefix || 'value']: obj };
  return Object.fromEntries(Object.entries(obj).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) return Object.entries(flatten(value, next));
    return [[next, value]];
  }));
}

function xml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
