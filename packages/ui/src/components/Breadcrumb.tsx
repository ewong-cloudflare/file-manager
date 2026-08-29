import { ChevronRight, HardDrive } from "lucide-react";

interface BreadcrumbProps {
  prefix: string;
  onNavigate: (prefix: string) => void;
}

export function Breadcrumb({ prefix, onNavigate }: BreadcrumbProps) {
  const segments = prefix ? prefix.replace(/\/$/, "").split("/") : [];

  return (
    <nav className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
      <button
        onClick={() => onNavigate("")}
        className="flex items-center gap-1 hover:text-blue-600 transition-colors font-medium"
      >
        <HardDrive className="w-3.5 h-3.5" />
        <span>My Files</span>
      </button>

      {segments.map((seg, i) => {
        const segPrefix = segments.slice(0, i + 1).join("/") + "/";
        const isLast = i === segments.length - 1;
        return (
          <span key={segPrefix} className="flex items-center gap-1">
            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            {isLast ? (
              <span className="text-slate-800 font-medium">{seg}</span>
            ) : (
              <button
                onClick={() => onNavigate(segPrefix)}
                className="hover:text-blue-600 transition-colors"
              >
                {seg}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
