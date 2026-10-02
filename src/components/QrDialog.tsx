import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { listScanPeople, personScanPath, qrSvg, scanUrl, supervisorScanPath, type ScanPerson } from "@/logic/scanLink";
import { OFFICES, officeLabel } from "@/logic/staffing";
import type { OfficeId, StaffingState } from "@/types";

export function QrDialog({
  date,
  staffing,
  onDate,
  onClose,
}: {
  date: string;
  staffing: StaffingState;
  onDate: (date: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"person" | "supervisor">("person");
  const [loc, setLoc] = useState<OfficeId>(staffing.officeId);
  const [pick, setPick] = useState("");
  const [loaded, setLoaded] = useState<{ loc: OfficeId; people: ScanPerson[] } | null>(null);
  const [qr, setQr] = useState<{ url: string; svg: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState("");
  const people = loaded?.loc === loc ? loaded.people : null;
  const person = people?.find((item) => personKey(item) === pick) ?? people?.[0] ?? null;
  const waiting = mode === "person" && people === null;
  const path = mode === "supervisor" || !person
    ? supervisorScanPath({ date, loc })
    : personScanPath({ staff: person.code, shift: person.shiftId, date, loc, cells: person.cells });
  const url = waiting || (mode === "person" && !person) ? "" : scanUrl(window.location.origin, path);
  const svg = qr && qr.url === url ? qr.svg : null;
  const copied = copiedUrl === url && url !== "";

  useEffect(() => {
    if (mode !== "person") return;
    let cancelled = false;
    const office = loc;
    const timer = window.setTimeout(() => {
      const next = listScanPeople(staffing, office);
      if (!cancelled) setLoaded({ loc: office, people: next });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [staffing, loc, mode]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    qrSvg(url).then((next) => {
      if (!cancelled) setQr({ url, svg: next });
    }).catch(() => {
      if (!cancelled) setQr({ url, svg: "" });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
    } catch {
      setCopiedUrl("");
    }
  }

  return (
    <dialog className="plain-dialog qr-dialog" open data-testid="qr-dialog" aria-label="產生 QR">
      <h2>產生 QR</h2>
      <div className="quick-row" role="group" aria-label="QR 種類">
        <button type="button" data-testid="qr-mode-person" className={mode === "person" ? "is-on" : ""} onClick={() => setMode("person")}>員工</button>
        <button type="button" data-testid="qr-mode-supervisor" className={mode === "supervisor" ? "is-on" : ""} onClick={() => setMode("supervisor")}>主管</button>
      </div>
      <label>日期
        <input type="date" aria-label="QR 日期" data-testid="qr-date" value={date} onChange={(event) => { if (event.target.value) onDate(event.target.value); }} />
      </label>
      <label>辦公區
        <select aria-label="QR 辦公區" data-testid="qr-loc" value={loc} onChange={(event) => setLoc(event.target.value as OfficeId)}>
          {OFFICES.map((office) => <option key={office.id} value={office.id}>{office.label}</option>)}
        </select>
      </label>
      {mode === "person" && (
        <label>員工
          <select
            aria-label="QR 員工"
            data-testid="qr-staff"
            value={person ? personKey(person) : ""}
            onChange={(event) => setPick(event.target.value)}
          >
            {(people ?? []).map((item) => (
              <option key={personKey(item)} value={personKey(item)}>{item.label}</option>
            ))}
          </select>
        </label>
      )}
      {waiting && <p data-testid="qr-waiting">編緊員工名單…</p>}
      {!waiting && url ? (
        <>
          <div className="qr-preview" data-testid="qr-image" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
          {svg === null && <p>QR 產生緊…</p>}
          {svg === "" && <p>QR 產生失敗。下面條連結仍然可以複製。</p>}
          <label>連結
            <input className="qr-link" readOnly data-testid="qr-link" value={url} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <div className="quick-row">
            <Button type="button" data-testid="qr-copy" onClick={() => void copy()}>{copied ? "已複製" : "複製連結"}</Button>
            <a href={url} target="_blank" rel="noreferrer">開呢條 link</a>
          </div>
        </>
      ) : !waiting ? (
        <p>呢個區未有員工可以出個人 QR。</p>
      ) : null}
      <p className="qr-note">
        QR 入面係呢條網址，掃開就係{mode === "person" ? `${person ? person.label : "員工"}嘅全日崗位` : `${officeLabel(loc)} 主管總覽`}。
        本機 localhost 只係呢部電腦開到；手機要同一 Wi-Fi，用 `npm run dev` 印出嘅局域网網址。
        試玩／內網，冇登入。未批唔好放上公開互聯網。
      </p>
      <div className="quick-row">
        <Button type="button" variant="outline" onClick={onClose}>關閉</Button>
      </div>
    </dialog>
  );
}

function personKey(person: ScanPerson) {
  return `${person.shiftId}:${person.rowId}`;
}
