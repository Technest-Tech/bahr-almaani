"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Language, LanguagePair, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";

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
  const [error, setError] = useState<string | null>(null);
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

  async function handleSave() {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      await api(`/users/${user.id}/language-pairs`, {
        method: "PUT",
        json: {
          pairs: pairs.filter((p) => p.source_language_id && p.target_language_id),
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "حدث خطأ");
    } finally {
      setSubmitting(false);
    }
  }

  function updatePair(index: number, key: keyof PairDraft, value: string) {
    setPairs((prev) =>
      prev.map((pair, i) =>
        i === index ? { ...pair, [key]: value ? Number(value) : "" } : pair,
      ),
    );
  }

  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      title={user ? `أزواج اللغات: ${user.name}` : ""}
    >
      <p className="mb-4 text-xs text-slate-500">
        يرى المترجم في البورتال الملفات المطابقة لأزواج لغاته فقط.
      </p>

      <div className="space-y-2">
        {pairs.map((pair, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select
              value={pair.source_language_id}
              onChange={(e) => updatePair(index, "source_language_id", e.target.value)}
            >
              <option value="">من لغة…</option>
              {languages?.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.name_ar}
                </option>
              ))}
            </Select>
            <ArrowLeft className="size-4 shrink-0 text-slate-400" />
            <Select
              value={pair.target_language_id}
              onChange={(e) => updatePair(index, "target_language_id", e.target.value)}
            >
              <option value="">إلى لغة…</option>
              {languages?.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.name_ar}
                </option>
              ))}
            </Select>
            <button
              onClick={() => setPairs((prev) => prev.filter((_, i) => i !== index))}
              className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
              title="حذف الزوج"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}

        {pairs.length === 0 && (
          <p className="rounded-lg bg-slate-50 py-6 text-center text-sm text-slate-400">
            لا توجد أزواج لغات بعد
          </p>
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="mt-3"
        onClick={() =>
          setPairs((prev) => [...prev, { source_language_id: "", target_language_id: "" }])
        }
      >
        <Plus className="size-4" />
        إضافة زوج لغات
      </Button>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          إلغاء
        </Button>
        <Button onClick={handleSave} loading={submitting}>
          حفظ
        </Button>
      </div>
    </Dialog>
  );
}
