"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface PromptOptions {
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const [promptState, setPromptState] = useState<PromptOptions | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const confirmResolver = useRef<(value: boolean) => void>(null);
  const promptResolver = useRef<(value: string | null) => void>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setConfirmState(options);
    return new Promise<boolean>((resolve) => {
      confirmResolver.current = resolve;
    });
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    setPromptValue("");
    setPromptState(options);
    return new Promise<string | null>((resolve) => {
      promptResolver.current = resolve;
    });
  }, []);

  const settleConfirm = (value: boolean) => {
    confirmResolver.current?.(value);
    confirmResolver.current = null;
    setConfirmState(null);
  };

  const settlePrompt = (value: string | null) => {
    promptResolver.current?.(value);
    promptResolver.current = null;
    setPromptState(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}

      <AlertDialog open={!!confirmState} onOpenChange={(open) => !open && settleConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
            {confirmState?.description && (
              <AlertDialogDescription>{confirmState.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                confirmState?.destructive &&
                  "bg-destructive text-white hover:bg-destructive/90",
              )}
              onClick={() => settleConfirm(true)}
            >
              {confirmState?.confirmLabel ?? "تأكيد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!promptState} onOpenChange={(open) => !open && settlePrompt(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{promptState?.title}</DialogTitle>
            {promptState?.description && (
              <DialogDescription>{promptState.description}</DialogDescription>
            )}
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (promptValue.trim()) settlePrompt(promptValue.trim());
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="prompt-input">{promptState?.label}</Label>
              <Textarea
                id="prompt-input"
                autoFocus
                required
                rows={3}
                placeholder={promptState?.placeholder}
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => settlePrompt(null)}>
                إلغاء
              </Button>
              <Button
                type="submit"
                variant={promptState?.destructive ? "destructive" : "default"}
                disabled={!promptValue.trim()}
              >
                {promptState?.confirmLabel ?? "تأكيد"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm must be used within ConfirmProvider");
  return context;
}
