"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { type LetterheadTemplate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TemplatePicker } from "@/components/letterheads/template-picker";

interface Props {
  open: boolean;
  projectId: number | string;
  onClose: () => void;
  onApproved: () => void;
}

/**
 * Approval carries the letterhead + stamp selection (M9): the API rejects an
 * approval without both, and the merge job reads them off the project.
 */
export function ApproveDialog({ open, projectId, onClose, onApproved }: Props) {
  const [letterheadId, setLetterheadId] = useState<number | null>(null);
  const [stampId, setStampId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["letterheads", "active"],
    queryFn: () =>
      api<{ data: LetterheadTemplate[] }>("/letterheads?active=1").then((r) => r.data),
    enabled: open,
  });

  const letterheads = data?.filter((t) => t.kind === "letterhead") ?? [];
  const stamps = data?.filter((t) => t.kind === "stamp") ?? [];
  const ready = letterheadId !== null && stampId !== null;

  async function handleApprove() {
    if (!ready) return;
    setSubmitting(true);
    try {
      await api(`/projects/${projectId}/review/approve`, {
        method: "POST",
        json: { letterhead_id: letterheadId, stamp_id: stampId },
      });
      toast.success("تم الاعتماد — جارِ تجهيز الملف النهائي");
      onApproved();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.errors
          ? Object.values(err.errors)[0][0]
          : err instanceof Error
            ? err.message
            : "حدث خطأ",
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>اعتماد الترجمة وإنهاء الملف</DialogTitle>
          <DialogDescription>
            اختر الترويسة والختم اللذين سيُدمجان في الملف النهائي — لا يمكن الاعتماد بدونهما.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <TemplatePicker
            kind="letterhead"
            title="الترويسة"
            templates={letterheads}
            loading={isLoading}
            selectedId={letterheadId}
            onSelect={setLetterheadId}
          />
          <TemplatePicker
            kind="stamp"
            title="الختم"
            templates={stamps}
            loading={isLoading}
            selectedId={stampId}
            onSelect={setStampId}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            onClick={handleApprove}
            loading={submitting}
            disabled={!ready}
            title={ready ? undefined : "اختر ترويسة وختماً أولاً"}
          >
            <BadgeCheck className="size-4" />
            اعتماد وإنهاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
