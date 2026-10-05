// Generates the sample procurement documents in public/samples (Excel BOQ, PDF BOQ, CSV list).
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const due = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d; };
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

const rows: [string, string, string, number | string, string, Date | null, string, string][] = [
  ["A", "ELECTRICAL WORKS - VILLAS 1-6", "", "", "", null, "", ""],
  ["A.1", "4C x 16mm XLPE/SWA/PVC Cu cable, 0.6/1kV", "mtr", 1200, "Ducab", due(14), "Villa cluster C", "Sub-mains to DBs"],
  ["A.2", "4 core x 35 sq.mm XLPE armoured cable", "mtr", 450, "Ducab", due(14), "Villa cluster C", ""],
  ["A.3", "Single core PVC wire 2.5 sqmm", "coil", 60, "Ducab", due(21), "", "100m coils"],
  ["A.4", "Single core PVC wire 4 sqmm", "coil", 25, "", due(21), "", ""],
  ["A.5", "13A twin switched socket outlet, white", "nos", 180, "MK", due(28), "", ""],
  ["A.6", "Light switch 1 gang 2 way", "nos", 140, "MK", due(28), "", ""],
  ["A.7", "MCB 1P 20A C curve 10kA", "nos", 90, "Schneider", due(21), "", ""],
  ["A.8", "RCBO 32A 30mA", "nos", 24, "Schneider", due(21), "", ""],
  ["A.9", "Distribution board TPN 18 way", "nos", 6, "Schneider", due(21), "", "IP42"],
  ["A.10", "PVC conduit 20mm heavy gauge", "mtr", 2400, "", due(10), "", ""],
  ["A.11", "LED downlight 12W 4000K", "nos", 260, "Philips", due(35), "", ""],
  ["", "Sub-total Electrical", "", "", "", null, "", ""],
  ["B", "HVAC WORKS", "", "", "", null, "", ""],
  ["B.1", "Copper refrigerant pipe 5/8\"", "mtr", 600, "", due(18), "", "Soft coil"],
  ["B.2", "Copper refrigerant pipe 3/8\"", "mtr", 600, "", due(18), "", ""],
  ["B.3", "Armaflex pipe insulation 19mm thk", "mtr", 1100, "Armaflex", due(18), "", ""],
  ["B.4", "Fan coil unit ducted 2 TR", "nos", 12, "Carrier", due(30), "", ""],
  ["B.5", "Square ceiling diffuser 600x600", "nos", 48, "", due(30), "", ""],
  ["C", "PLUMBING", "", "", "", null, "", ""],
  ["C.1", "PPR pipe PN20 25mm", "mtr", 900, "Cosmoplast", due(12), "", ""],
  ["C.2", "PPR elbow 25mm", "nos", 300, "Cosmoplast", due(12), "", ""],
  ["C.3", "uPVC drainage pipe 110mm", "mtr", 240, "", due(12), "", ""],
  ["C.4", "Ball valve 3/4\" brass full bore", "nos", 36, "", due(12), "", ""],
  ["C.5", "Marble threshold installation - labour only", "lot", 1, "", null, "", "Provisional"],
];

async function main() {
  // ---- Excel
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("MEP BOQ");
  ws.addRow(["Dubai Villa Project - MEP Bill of Quantities (Rev B)"]).font = { bold: true, size: 13 };
  ws.addRow(["Client: Private client · Location: Al Barari, Dubai"]);
  ws.addRow([]);
  const header = ws.addRow(["Item", "Description", "Unit", "Qty", "Brand / Make", "Required Date", "Location", "Remarks", "Rate (AED)", "Amount (AED)"]);
  header.font = { bold: true };
  for (const r of rows) ws.addRow([r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], "", ""]);
  ws.columns.forEach((c, i) => { c.width = [8, 48, 8, 8, 14, 14, 16, 18, 10, 12][i]; });
  ws.getColumn(6).numFmt = "dd/mm/yyyy";
  await wb.xlsx.writeFile("public/samples/dubai-villa-mep-boq.xlsx");

  // ---- CSV (site procurement list, free-form headers)
  const csv = [
    "S.No,Material,Size / Rating,Qty,UOM,Need by,Area,Notes",
    `1,XLPE SWA cable 4 core,25 sq.mm,300,m,${dmy(due(9))},Villa 4,urgent`,
    `2,GI conduit,25mm,180,m,${dmy(due(9))},Villa 4,`,
    `3,Cable tray perforated,300mm wide,60,m,${dmy(due(9))},Plant room,`,
    `4,Anchor bolt,M12,400,nos,${dmy(due(7))},,`,
    `5,Threaded rod M10,3m,120,nos,${dmy(due(7))},,`,
    `6,Polyurethane sealant 600ml,,48,pcs,${dmy(due(15))},,`,
    `7,Cable ties 300mm,,20,pack,${dmy(due(7))},,`,
  ].join("\n");
  writeFileSync("public/samples/site-procurement-list.csv", csv);

  // ---- PDF
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  let y = 800;
  const text = (s: string, x: number, f = font, size = 9) => page.drawText(s, { x, y, size, font: f, color: rgb(0.1, 0.1, 0.12) });
  text("DUBAI VILLA PROJECT - BILL OF QUANTITIES", 40, bold, 13); y -= 16;
  text("Section 16: Electrical & Mechanical Services - issued for procurement", 40); y -= 26;
  text("Item", 40, bold); text("Description", 80, bold); text("Qty", 380, bold); text("Unit", 430, bold); text("Make", 470, bold); y -= 14;
  for (const r of rows) {
    if (y < 60) { page = pdf.addPage([595, 842]); y = 800; }
    if (!r[3]) { y -= 4; text(r[1].replace(/\s*-\s*/g, " "), 40, bold); y -= 14; continue; }
    text(r[0], 40); text(r[1].replace(/"/g, " inch"), 80); text(Number(r[3]).toLocaleString("en-US"), 380); text(r[2], 430); text(r[4], 470); y -= 13;
  }
  writeFileSync("public/samples/dubai-villa-boq.pdf", await pdf.save());
  console.log("Samples written to public/samples");
}
main();
