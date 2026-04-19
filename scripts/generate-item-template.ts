// Generates public/templates/ItemUpdateTemplate.xlsx with styled headers and
// italic instruction rows. Run with:
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/generate-item-template.ts

import * as XLSX from "xlsx-js-style";
import * as path from "path";
import * as fs from "fs";

const OUTPUT = path.join(
  process.cwd(),
  "public",
  "templates",
  "ItemUpdateTemplate.xlsx"
);

// Canopy UI accent blue (matches --c-accent in app)
const BLUE = "2563EB";
const GRAY = "F3F4F6";

const headerStyle = {
  fill: { fgColor: { rgb: BLUE } },
  font: { color: { rgb: "FFFFFF" }, bold: true, name: "Calibri", sz: 11 },
  alignment: { horizontal: "left", vertical: "center" },
  border: {
    bottom: { style: "thin", color: { rgb: "1E3A8A" } },
  },
};

const instructionStyle = {
  fill: { fgColor: { rgb: GRAY } },
  font: { italic: true, color: { rgb: "475569" }, name: "Calibri", sz: 10 },
  alignment: { horizontal: "left", vertical: "center", wrapText: true },
};

type Sheet = {
  name: string;
  headers: string[];
  instructions: string[];
  widths: number[];
};

const VENDORS: Sheet = {
  name: "Vendors",
  headers: ["VENDOR#", "VENDOR NAME", "COUNTRY OF ORIGIN"],
  instructions: [
    "Enter WDS vendor code (e.g. HRN)",
    "Enter vendor's full name",
    "Enter country: china, malaysia, thailand, or indonesia",
  ],
  widths: [16, 36, 28],
};

const ITEMS: Sheet = {
  name: "Items",
  headers: [
    "ITEM#",
    "ITEM NAME",
    "STATUS",
    "ASIN",
    "DI ENROLLED",
    "KIT PARENT",
    "VENDOR#",
    "FCL QTY 40GP",
    "FCL QTY 40HQ",
    "MOQ",
    "UNIT COST (USD)",
    "TIER OVERRIDE",
  ],
  instructions: [
    "Enter SKU code (e.g. 10727)",
    "Enter product name",
    "Enter: active, discontinued, or seasonal",
    "Enter Amazon ASIN (e.g. B08XYZ123)",
    "Enter YES or NO",
    "Enter YES or NO",
    "Enter vendor code (must match Vendors sheet)",
    "Approx units that fill one 40' General Purpose (from factory quote)",
    "Approx units that fill one 40' High Cube (from factory quote)",
    "Minimum order quantity (integer)",
    "Landed cost per unit in USD (e.g. 12.50)",
    "Optional: A, B, C, or LP (leave blank to let system assign)",
  ],
  widths: [12, 32, 14, 14, 14, 14, 14, 16, 16, 10, 18, 14],
};

const KITS: Sheet = {
  name: "Kits",
  headers: ["PARENT ITEM#", "CHILD ITEM#", "QTY PER KIT"],
  instructions: [
    "Kit parent SKU (e.g. 20001)",
    "Child SKU that is consumed when one kit ships",
    "How many of this child per one parent kit (positive integer)",
  ],
  widths: [18, 18, 14],
};

function buildSheet(s: Sheet): XLSX.WorkSheet {
  const data = [s.headers, s.instructions];
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Apply styles per cell
  for (let c = 0; c < s.headers.length; c++) {
    const headerRef = XLSX.utils.encode_cell({ r: 0, c });
    const instrRef = XLSX.utils.encode_cell({ r: 1, c });
    if (ws[headerRef]) ws[headerRef].s = headerStyle;
    if (ws[instrRef]) ws[instrRef].s = instructionStyle;
  }

  // Column widths
  ws["!cols"] = s.widths.map((w) => ({ wch: w }));

  // Row heights: header 22, instruction 36 (wrapping)
  ws["!rows"] = [{ hpt: 22 }, { hpt: 36 }];

  // Freeze the header + instruction rows so they stay visible
  ws["!freeze"] = { xSplit: 0, ySplit: 2 };

  return ws;
}

function buildReadme(): XLSX.WorkSheet {
  const lines = [
    ["CANOPY — Item Update Template"],
    [""],
    ["This workbook updates SKU attributes, vendor records, and kit bills-of-materials in bulk."],
    [""],
    ["SHEETS"],
    ["  1. Vendors — register or update vendor codes + country of origin."],
    ["  2. Items — update SKU attributes, vendor assignment, FCL quantities, cost, MOQ."],
    ["  3. Kits — define kit parent → child components with qty-per-kit."],
    [""],
    ["RULES"],
    ["  • Row 1 in each sheet is the header (blue). Row 2 is an instruction row (gray italic) — leave it as-is."],
    ["  • Blank cells are ignored. The importer never clears fields — use the UI/DB to wipe values."],
    ["  • On Items sheet: if VENDOR# differs from the SKU's current vendor, a pending vendor transition row is created; current production values stay in effect until the next PO on the new vendor lands."],
    ["  • Kit Parents and Kit Components are mutually exclusive. A SKU cannot be both."],
    [""],
    ["FCL QUANTITIES"],
    ["  • FCL QTY 40GP and FCL QTY 40HQ are approximate SKU-only Full Container Load counts from your factory quotes."],
    ["  • Used as buyer guidance — when a SKU's recommended order approaches its FCL number, consider rounding up to the FCL."],
    ["  • Factories typically confirm 40GP vs 40HQ after the PO is placed, so both are stored on the SKU."],
  ];
  const ws = XLSX.utils.aoa_to_sheet(lines);
  ws["!cols"] = [{ wch: 120 }];
  // Bold the title + section headers
  const bold = { font: { bold: true, sz: 12 } };
  for (const ref of ["A1", "A5", "A10", "A16"]) {
    if (ws[ref]) ws[ref].s = bold;
  }
  return ws;
}

function main() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildReadme(), "README");
  XLSX.utils.book_append_sheet(wb, buildSheet(VENDORS), VENDORS.name);
  XLSX.utils.book_append_sheet(wb, buildSheet(ITEMS), ITEMS.name);
  XLSX.utils.book_append_sheet(wb, buildSheet(KITS), KITS.name);

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  XLSX.writeFile(wb, OUTPUT);
  console.log(`Wrote ${OUTPUT}`);
}

main();
