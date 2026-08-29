import { HardDrive } from "lucide-react";
import type { UserInfo } from "../lib/api";

interface HeaderProps {
  user: UserInfo | null;
}

function getInitials(user: UserInfo): string {
  if (user.name && user.name !== user.email) {
    return user.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return user.email[0].toUpperCase();
}

export function Header({ user }: HeaderProps) {
  return (
    <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 bg-blue-600 rounded-lg">
          <HardDrive className="w-4 h-4 text-white" />
        </div>
        <span className="font-semibold text-slate-800 text-sm">File Manager</span>
        <span className="text-slate-300 text-sm">·</span>
        <span className="text-xs text-slate-400">Cloudflare R2</span>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <div className="flex items-center gap-2" title={user.email}>
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                <span className="text-xs font-semibold text-blue-700">{getInitials(user)}</span>
              </div>
              <span className="text-xs text-slate-600 hidden sm:block max-w-[180px] truncate">
                {user.email}
              </span>
            </div>
          ) : (
            <div className="w-7 h-7 rounded-full bg-slate-100 animate-pulse" />
          )}
        </div>
      </div>
    </header>
  );
}
