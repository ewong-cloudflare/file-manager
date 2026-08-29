interface ProgressBarProps {
  progress: number;
  status: "uploading" | "complete" | "error";
}

export function ProgressBar({ progress, status }: ProgressBarProps) {
  const colorClass =
    status === "complete"
      ? "bg-emerald-500"
      : status === "error"
        ? "bg-red-500"
        : "bg-blue-500";

  return (
    <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-1.5 rounded-full transition-all duration-200 ${colorClass}`}
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}
