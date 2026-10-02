import { ScanScreen } from "@/components/ScanScreen";
import { StaffingScreen } from "@/components/StaffingScreen";
import { parseScanSearch } from "@/logic/scanLink";

export default function App() {
  const scan = parseScanSearch(window.location.search);
  if (scan) return <ScanScreen request={scan} />;
  return <StaffingScreen />;
}
