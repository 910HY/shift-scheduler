import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TEMPLATES, type TemplateId, type Zone } from "@/types";

export function PostFormDialog({
  open,
  zones,
  templateId,
  zoneId,
  name,
  onTemplate,
  onZone,
  onName,
  onClose,
  onCreate,
}: {
  open: boolean;
  zones: Zone[];
  templateId: TemplateId;
  zoneId: string;
  name: string;
  onTemplate: (templateId: TemplateId) => void;
  onZone: (zoneId: string) => void;
  onName: (name: string) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新增崗位</DialogTitle>
          <DialogDescription>
            ARR、DEP、KIOSK、候命只是模板。點下去會預填名稱和區域，儲存前可以改，之後也能改名、換區或刪除。
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map((template) => (
            <Button
              key={template.id}
              type="button"
              variant={template.id === templateId ? "default" : "outline"}
              className="h-auto flex-col items-start px-3 py-2"
              aria-pressed={template.id === templateId}
              onClick={() => onTemplate(template.id)}
            >
              <span className="font-mono text-[11px] tracking-[0.14em]">{template.code}</span>
              <span>{template.label}</span>
              <span className="text-xs opacity-70">{template.blurb}</span>
            </Button>
          ))}
        </div>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="post-name">崗位名稱</Label>
            <Input id="post-name" value={name} onChange={(event) => onName(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="post-zone">放到哪個區</Label>
            <select
              id="post-zone"
              value={zoneId}
              onChange={(event) => onZone(event.target.value)}
              className="h-10 rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.code} · {zone.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={onCreate} disabled={!name.trim()}>
            加上崗位
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type StaffDraft = {
  id: string | null;
  code: string;
  shift: string;
  dutyStart: string;
  dutyEnd: string;
  breakStart: string;
  breakEnd: string;
  leaveEarlyAt: string;
  returnLateAt: string;
  restLocked: boolean;
};

export function StaffFormDialog({
  draft,
  error,
  onChange,
  onClose,
  onSave,
  onRemove,
}: {
  draft: StaffDraft | null;
  error: string | null;
  onChange: (draft: StaffDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {draft && (
          <>
            <DialogHeader>
              <DialogTitle>{draft.id ? `人員 ${draft.code}` : "加入人員"}</DialogTitle>
              <DialogDescription>編號、更份、崗位 In／Out、MB In／Out。S/L 與 UVL 是例外。人先進入休息區。</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <Field label="編號" value={draft.code} onChange={(code) => onChange({ ...draft, code })} />
              <Field label="更份" value={draft.shift} onChange={(shift) => onChange({ ...draft, shift })} />
              <Field label="崗位 In" type="time" value={draft.dutyStart} onChange={(dutyStart) => onChange({ ...draft, dutyStart })} />
              <Field label="崗位 Out" type="time" value={draft.dutyEnd} onChange={(dutyEnd) => onChange({ ...draft, dutyEnd })} />
              <Field label="MB In" type="time" value={draft.breakStart} onChange={(breakStart) => onChange({ ...draft, breakStart })} />
              <Field label="MB Out" type="time" value={draft.breakEnd} onChange={(breakEnd) => onChange({ ...draft, breakEnd })} />
              <Field
                label="S/L"
                type="time"
                value={draft.leaveEarlyAt}
                onChange={(leaveEarlyAt) => onChange({ ...draft, leaveEarlyAt })}
              />
              <Field
                label="UVL"
                type="time"
                value={draft.returnLateAt}
                onChange={(returnLateAt) => onChange({ ...draft, returnLateAt })}
              />
            </div>
            {!draft.id && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.restLocked}
                  onChange={(event) => onChange({ ...draft, restLocked: event.target.checked })}
                />
                進休息區時先鎖定，重算不會抽走
              </label>
            )}
            {error && <p className="text-status-alert text-sm">{error}</p>}
            <DialogFooter>
              {draft.id && (
                <Button type="button" variant="destructive" className="mr-auto" onClick={onRemove}>
                  移走此人
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button type="button" onClick={onSave}>
                儲存
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  const id = `staff-${label}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
