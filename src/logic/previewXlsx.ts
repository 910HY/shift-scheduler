import ExcelJS from "exceljs";
import { EARLY_CELL, isLoanMarker, isRestCode, previewFilename, rosterRows, slotStarts } from "@/logic/staffing";
import type { RosterRow, StaffingState } from "@/types";

const ORANGE = "FFF4B183";
const BLUE = "FF9DC3E6";
const AMBER = "FFF8CBAD";
const INK = "FF1A1D23";
const HEADER = "FF1A1D23";
const LOAN = "FFE7E9EE";

export async function buildPreviewWorkbook(staffing: StaffingState, rows: RosterRow[] = rosterRows(staffing, staffing.officeId)) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "渣板";
  workbook.title = previewFilename(staffing);
  workbook.description = "草稿預覽，未當正式更表";
  const sheet = workbook.addWorksheet("preview");
  const slots = slotStarts(staffing.shiftId);
  sheet.addRow(["員工", ...slots, "在崗", "R"]);
  styleHeader(sheet.getRow(1));
  for (const row of rows) {
    const onDuty = row.cells.filter((cell) => cell && !isRestCode(cell) && !isLoanMarker(cell)).length;
    const rests = row.cells.filter((cell) => cell === "R").length;
    const added = sheet.addRow([row.code, ...row.cells, onDuty, rests]);
    added.eachCell((cell, index) => {
      if (index === 1 || index > slots.length + 1) return;
      paint(cell, String(cell.value ?? ""));
    });
  }
  const note = sheet.addRow(["草稿預覽，未當正式更表"]);
  note.font = { italic: true, color: { argb: "FF5C6370" } };
  sheet.getColumn(1).width = 16;
  slots.forEach((_, index) => {
    sheet.getColumn(index + 2).width = 14;
  });
  return workbook.xlsx.writeBuffer();
}

export function previewDownloadName(staffing: StaffingState) {
  return previewFilename(staffing);
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER } };
    cell.alignment = { horizontal: "center" };
  });
}

function paint(cell: ExcelJS.Cell, value: string) {
  cell.alignment = { horizontal: "center" };
  if (value === "R") {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } };
    cell.font = { color: { argb: INK } };
    return;
  }
  if (value === "B" || value === "MB") {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };
    return;
  }
  if (value.startsWith("Apc")) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    cell.font = { color: { argb: INK } };
    return;
  }
  if (isLoanMarker(value) || value === EARLY_CELL) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LOAN } };
    cell.font = { color: { argb: "FF5C6370" } };
  }
}
