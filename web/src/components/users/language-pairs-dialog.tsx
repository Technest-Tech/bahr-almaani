"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Language, LanguagePair, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}

interface PairDraft {
  source_language_id: number | "";
  target_language_id: number | "";
}

/**
 * Server pairs render until the first local edit; then the draft takes over.
 * The parent remounts this dialog via a `key` per user, resetting the draft.
 */
export function LanguagePairsDialog({ user, onClose, onSaved }: Props) {
  const [editedPairs, setEditedPairs] = useState<PairDraft[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: languages } = useQuery({
    queryKey: ["languages"],
    queryFn: () => api<{ data: Language[] }>("/languages").then((r) => r.data),
    staleTime: Infinity,
  });

  const { data: currentPairs } = useQuery({
    queryKey: ["language-pairs", user?.id],
    queryFn: () =>
      api<{ data: LanguagePair[] }>(`/users/${user!.id}/language-pairs`).then((r) => r.data),
    enabled: !!user,
  });

  const pairs: PairDraft[] =
    editedPairs ??
    currentPairs?.map((p) => ({
      source_language_id: p.source_language_id,
      target_language_id: p.target_language_id,
    })) ??
    [];
  const setPairs = (updater: (prev: PairDraft[]) => PairDraft[]) =>
    setEditedPairs(updater(pairs));

  const languageOptions =
    languages?.map((lang) => ({ value: String(lang.id), label: lang.name_ar })) ?? [];

  async function handleSave() {
    if (!user) return;
    setSubmitting(true);
    try {
      await api(`/users/${user.id}/language-pairs`, {
        method: "PUT",
        json: {
          pairs: pairs.filter((p) => p.source_language_id && p.target_language_id),
        },
      });
      toast.success("تم حفظ أزواج اللغات");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "حدث خطأ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>أزواج اللغات: {user?.name}</DialogTitle>
          <DialogDescription>
            يرى المترجم في البورتال الملفات المطابقة لأزواج لغاته فقط.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {pairs.map((pair, index) => (
            <div key={index} className="flex items-center gap-2">
              <Combobox
                options={languageOptions}
                value={pair.source_language_id ? String(pair.source_language_id) : ""}
                onChange={(value) =>
                  setPairs((prev) =>
                    prev.map((p, i) =>
                      i === index ? { ...p, source_language_id: value ? Number(value) : "" } : p,
                    ),
                  )
                }
                placeholder="من لغة…"
                searchPlaceholder="ابحث عن لغة…"
              />
              <ArrowLeft className="size-4 shrink-0 text-muted-foreground" />
              <Combobox
                options={languageOptions}
                value={pair.target_language_id ? String(pair.target_language_id) : ""}
                onChange={(value) =>
                  setPairs((prev) =>
                    prev.map((p, i) =>
                      i === index ? { ...p, target_language_id: value ? Number(value) : "" } : p,
                    ),
                  )
                }
                placeholder="إلى لغة…"
                searchPlaceholder="ابحث عن لغة…"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setPairs((prev) => prev.filter((_, i) => i !== index))}
                title="حذف الزوج"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}

          {pairs.length === 0 && (
            <p className="rounded-lg bg-muted py-6 text-center text-sm text-muted-foreground">
              لا توجد أزواج لغات بعد
            </p>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setPairs((prev) => [...prev, { source_language_id: "", target_language_id: "" }])
            }
          >
            <Plus className="size-4" />
            إضافة زوج لغات
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={handleSave} loading={submitting}>
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
